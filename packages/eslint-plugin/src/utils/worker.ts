// Must stay a fully type-only import: under `verbatimModuleSyntax` an
// `import { type X }` survives as a runtime import, which pulls the plugin
// entry — and its `createSyncFn` call — into this worker's bundle.
import type { ImportResult } from '.'
import { loadConfig } from '@bamboocss/config'
import { resolveTsPathPattern } from '@bamboocss/config/ts-path'
import { Generator } from '@bamboocss/generator'
import { logger } from '@bamboocss/logger'
import micromatch from 'micromatch'
import { readFileSync, statSync } from 'node:fs'
import path from 'path'
import { runAsWorker } from 'synckit'
import { configFor } from './config-path'

type Options = {
  configPath?: string
  currentFile: string
  /** ESLint's working directory, which a relative `configPath` is read against. */
  cwd?: string
}

/** A config's context, and — for one that failed to load — the config's mtime it failed at. */
const contextCache = new Map<string, { context: Promise<Generator>; failedAt?: number }>()

/** `@bamboocss/node`, loaded once, and only when a rule needs a context. */
let nodeModule: Promise<typeof import('@bamboocss/node')> | undefined
const loadNode = () => (nodeModule ??= import('@bamboocss/node'))

/**
 * Nothing the worker logs reaches ESLint's output, where a line corrupts `--format json`: no
 * level, and no filter, which would lift the level to `debug` for what it matches. Again after
 * every config load, which sets both from the config.
 */
const silence = () => {
  logger.level = 'silent'
  logger.filter = ''
}

const mtimeOf = (file: string) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1

export type DeprecatedToken =
  | string
  | {
      category: string
      value: string
    }

// Set by this repo's own test suite to the module that builds a Generator from
// the fixture config. Never set for consumers of the published package, which
// ships `dist` only — keying this off NODE_ENV would break anyone linting with
// NODE_ENV=test, since the fixtures are not published.
const testContextModule = process.env.BAMBOO_ESLINT_TEST_CONTEXT

/**
 * The context every rule reads: `@bamboocss/node`'s, as the build prepares it — `include` matched
 * from the config's directory, the tsconfig's aliases read, the extraction behind it — one per
 * config, so no two rules answer from different readings of one config.
 *
 * A config that fails to load is not loaded again until it changes: once per edit that broke it,
 * rather than once per question every rule asks of every file.
 */
export async function getContext(options: Options): Promise<Generator> {
  silence()
  const key = testContextModule ?? configFor(options)
  const cached = contextCache.get(key)
  if (cached && (cached.failedAt === undefined || cached.failedAt === mtimeOf(key))) return cached.context

  const entry: { context: Promise<Generator>; failedAt?: number } = { context: createContext(key) }
  entry.context.then(silence, () => {
    entry.failedAt = mtimeOf(key)
  })
  contextCache.set(key, entry)
  return entry.context
}

async function createContext(configPath: string): Promise<Generator> {
  if (testContextModule) {
    const { createContext } = await import(testContextModule)
    return createContext({
      exclude: ['**/Invalid.tsx', '**/bamboo.config.ts'],
      importMap: './bamboo',
      include: ['**/*'],
    })
  }

  const cwd = path.dirname(configPath)
  const { loadConfigAndCreateContext } = await loadNode()
  try {
    return await loadConfigAndCreateContext({ configPath, cwd })
  } catch {
    // The build's preparation refused what the generator alone does not need — a tsconfig that
    // does not parse, class names the build and the browser would disagree on. The rules that
    // read only the config go on from it, and the extraction stands aside.
    const conf = await loadConfig({ cwd, file: configPath })
    conf.config.cwd ??= cwd
    return new Generator(conf)
  }
}

/**
 * The styles in `text` the build could not read: where they are, what is lost and what to do —
 * what `bamboo` warns about at build time, each declaration it names absent from the stylesheet.
 * Asked only of a file that imports bamboo and that `include` reaches (`getUnresolvedStyles`).
 *
 * None for a file under `outdir`, which nothing the author writes would change, as the build skips
 * it too; nor for one the build reads rewritten — a `.vue`, `.svelte` or `.astro` file, or one a
 * plugin's `parser:before` changes — whose positions are not the file's. The editor's text stands
 * in for the file only while it is read, and only where it differs from the file: another file
 * importing this one reads what is on disk. Its styles are encoded apart, and dropped: nothing in
 * the worker emits CSS, and a long editor session would otherwise keep every version linted.
 */
const unresolvedStyles = async (options: Options, text: string) => {
  const [context, { BambooContext, explainUnresolvedStyle }] = await Promise.all([getContext(options), loadNode()])
  if (!(context instanceof BambooContext)) return []
  const file = path.resolve(options.cwd ?? process.cwd(), options.currentFile)
  if (context.isGenerated(file)) return []

  // ESLint drops a byte order mark from the text it lints.
  const overlaid = readIfExists(file)?.replace(/^\uFEFF/, '') !== text
  if (overlaid) context.project.addSourceFile(file, text)
  try {
    if (context.parsedSourceText(file) !== text) return []
    const result = context.parseFile(file, context.encoder.clone())
    return (result?.unresolved ?? [])
      .filter((entry) => path.resolve(entry.filePath) === file)
      .map((entry) => {
        const { fix, what } = explainUnresolvedStyle(entry)
        return { column: entry.column, fix, line: entry.line, what }
      })
  } finally {
    if (overlaid) context.project.removeOverlay(file)
  }
}

const readIfExists = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

// Refactored to arrow function, removed async
const filterDeprecatedTokens = (context: Generator, tokens: DeprecatedToken[]): DeprecatedToken[] => {
  return tokens.filter((token) => {
    const value = typeof token === 'string' ? token : token.category + '.' + token.value
    return context.utility.tokens.isDeprecated(value)
  })
}

// Refactored to arrow function, removed async
const filterInvalidTokens = (context: Generator, paths: string[]): string[] => {
  return paths.filter((path) => !context.utility.tokens.view.get(path))
}

/**
 * The build's own verdict on one property/value pair, for the editor.
 *
 * The same predicate and the same sentence the build prints — not a second implementation of
 * either. The type layer used to give this feedback by narrowing every generated prop type, at
 * a measured 19% of the types and 28% of the instantiations in a real project, and it could
 * only ever say "not assignable"; the resolver knows the value is a `sizes` token used on a
 * property that reads `spacing`, and knowing that is the whole point.
 */
const explainUnresolvedValue = (context: Generator, property: string, value: string): string | undefined => {
  const { utility } = context
  if (!utility.isUnresolvedTokenValue(property, value)) return undefined

  const key = utility.resolveShorthand(property)
  return utility.explainUnresolvedToken(utility.unresolvedTokenRef(key, utility.bareTokenPath(key, value)))
}

// Refactored to arrow function, removed async
const getPropertyCategory = (context: Generator, _attribute: string) => {
  const longhand = resolveLongHand(context, _attribute)
  const attribute = longhand || _attribute
  const attributeConfig = context.utility.config[attribute]
  return typeof attributeConfig?.values === 'string' ? attributeConfig.values : undefined
}

// Refactored to arrow function, removed async
const isColorAttribute = (context: Generator, _attribute: string): boolean => {
  const category = getPropertyCategory(context, _attribute)
  return category === 'colors'
}

// Refactored to arrow function, removed async
const isColorToken = (context: Generator, value: string): boolean => {
  return Boolean(context.utility.tokens.view.categoryMap.get('colors')?.get(value))
}

/** A style the build could not read: where it is, what is lost, and what to do about it. */
export type UnresolvedStyleReport = { column: number; fix: string; line: number; what: string }

type MatchImportResult = {
  alias: string
  mod: string
  name: string
}

export function run(action: 'filterInvalidTokens', options: Options, paths: string[]): string[]
export function run(
  action: 'explainUnresolvedValue',
  options: Options,
  property: string,
  value: string,
): string | undefined

export function run(action: 'isColorToken', options: Options, value: string): boolean

export function run(action: 'isColorAttribute', options: Options, attribute: string): boolean

export function run(action: 'isValidFile', options: Options): boolean

export function run(action: 'resolveShorthands', options: Options, name: string): string[] | undefined
export function run(action: 'resolveLongHand', options: Options, name: string): string | undefined

export function run(action: 'isValidProperty', options: Options, name: string, patternName?: string): boolean
export function run(action: 'matchFile', options: Options, name: string, imports: ImportResult[]): boolean
export function run(action: 'matchImports', options: Options, result: MatchImportResult): boolean
export function run(action: 'filterImports', options: Options, imports: MatchImportResult[]): MatchImportResult[]
export function run(action: 'getPropCategory', options: Options, property: string): string
export function run(action: 'filterDeprecatedTokens', options: Options, tokens: DeprecatedToken[]): DeprecatedToken[]
export function run(action: 'unresolvedStyles', options: Options, text: string): UnresolvedStyleReport[]
export function run(action: string, options: Options, ...args: any[]): any {
  // @ts-expect-error cast
  return runAsync(action, options, ...args)
}

export function runAsync(action: 'filterInvalidTokens', options: Options, paths: string[]): Promise<string[]>
export function runAsync(
  action: 'explainUnresolvedValue',
  options: Options,
  property: string,
  value: string,
): Promise<string | undefined>
export function runAsync(action: 'isColorToken', options: Options, value: string): Promise<boolean>
export function runAsync(action: 'isColorAttribute', options: Options, attribute: string): Promise<boolean>
export function runAsync(action: 'isValidFile', options: Options, fileName: string): Promise<string>
export function runAsync(action: 'resolveShorthands', options: Options, name: string): Promise<string[] | undefined>
export function runAsync(action: 'resolveLongHand', options: Options, name: string): Promise<string | undefined>

export function runAsync(
  action: 'isValidProperty',
  options: Options,
  name: string,
  patternName?: string,
): Promise<boolean>
export function runAsync(action: 'matchFile', options: Options, name: string, imports: ImportResult[]): Promise<boolean>
export function runAsync(action: 'matchImports', options: Options, result: MatchImportResult): Promise<boolean>
export function runAsync(
  action: 'filterImports',
  options: Options,
  imports: MatchImportResult[],
): Promise<MatchImportResult[]>
export function runAsync(action: 'getPropCategory', options: Options, property: string): Promise<string>
export function runAsync(
  action: 'filterDeprecatedTokens',
  options: Options,
  tokens: DeprecatedToken[],
): Promise<DeprecatedToken[]>
export async function runAsync(action: string, options: Options, ...args: any): Promise<any> {
  if (action === 'unresolvedStyles') return unresolvedStyles(options, args[0])

  const context = await getContext(options)

  switch (action) {
    case 'filterDeprecatedTokens':
      // @ts-expect-error cast
      return filterDeprecatedTokens(context, ...args)
    case 'filterImports':
      // @ts-expect-error cast
      return filterImports(context, ...args)
    case 'explainUnresolvedValue':
      // @ts-expect-error cast
      return explainUnresolvedValue(context, ...args)
    case 'filterInvalidTokens':
      // @ts-expect-error cast
      return filterInvalidTokens(context, ...args)
    case 'getPropCategory':
      // @ts-expect-error cast
      return getPropertyCategory(context, ...args)
    case 'isColorAttribute':
      // @ts-expect-error cast
      return isColorAttribute(context, ...args)
    case 'isColorToken':
      // @ts-expect-error cast
      return isColorToken(context, ...args)
    case 'isValidFile':
      return isValidFile(context, path.resolve(options.cwd ?? process.cwd(), options.currentFile))
    case 'isValidProperty':
      // @ts-expect-error cast
      return isValidProperty(context, ...args)
    case 'matchFile':
      // @ts-expect-error cast
      return matchFile(context, ...args)
    case 'matchImports':
      // @ts-expect-error cast
      return matchImports(context, ...args)
    case 'resolveLongHand':
      // @ts-expect-error cast
      return resolveLongHand(context, ...args)
    case 'resolveShorthands':
      // @ts-expect-error cast
      return resolveShorthands(context, ...args)
  }
}

// Refactored to use micromatch instead of getFiles() for O(1) performance
const isValidFile = (context: Generator, fileName: string): boolean => {
  const { exclude, include } = context.config
  const cwd = context.config.cwd || process.cwd()

  const relativePath = path.isAbsolute(fileName) ? path.relative(cwd, fileName) : fileName

  return micromatch.isMatch(relativePath, include, {
    dot: true,
    ignore: exclude,
  })
}

// Refactored to arrow function, removed async
const isValidProperty = (context: Generator, name: string, patternName?: string) => {
  if (context.isValidProperty(name)) {
    return true
  }

  if (!patternName) {
    return false
  }

  const pattern = context.patterns.details.find((p) => p.baseName === patternName)?.config.properties
  if (!pattern) {
    return false
  }

  return Object.keys(pattern).includes(name)
}

// Refactored to arrow function, removed async
const matchFile = (context: Generator, name: string, imports: ImportResult[]) => {
  const file = context.imports.file(imports)
  return file.match(name)
}

// Refactored to arrow function, removed async
const matchImports = (context: Generator, result: MatchImportResult) => {
  return context.imports.match(result, (module_) => {
    const { tsOptions } = context.parserOptions
    if (!tsOptions?.pathMappings) {
      return
    }

    return resolveTsPathPattern(tsOptions.pathMappings, module_)
  })
}

// Batch filter imports to reduce worker thread crossings
const filterImports = (context: Generator, imports: MatchImportResult[]): MatchImportResult[] => {
  return imports.filter((imp) =>
    context.imports.match(imp, (module_) => {
      const { tsOptions } = context.parserOptions
      if (!tsOptions?.pathMappings) {
        return
      }

      return resolveTsPathPattern(tsOptions.pathMappings, module_)
    }),
  )
}

// Cache reverse shorthand map per context to avoid O(N) rebuild on every call
const reverseShorthandsMapCache = new WeakMap<Generator, Map<string, string>>()

const getReverseShorthandsMap = (context: Generator): Map<string, string> => {
  let reverseMap = reverseShorthandsMapCache.get(context)
  if (!reverseMap) {
    reverseMap = new Map()
    const shorthands = context.utility.getPropShorthandsMap()
    for (const [key, values] of shorthands) {
      for (const value of values) {
        reverseMap.set(value, key)
      }
    }

    reverseShorthandsMapCache.set(context, reverseMap)
  }

  return reverseMap
}

// Refactored to use cached reverse shorthand map
const resolveLongHand = (context: Generator, name: string): string | undefined => {
  return getReverseShorthandsMap(context).get(name)
}

// Refactored to arrow function, removed async
const resolveShorthands = (context: Generator, name: string): string[] | undefined => {
  return context.utility.getPropShorthandsMap().get(name)
}

runAsWorker(run as any)
