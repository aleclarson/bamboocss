import { logger } from '@bamboocss/logger'
import { BambooError } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { build, type Plugin } from 'esbuild'
import findUp from 'escalade/sync'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import Module, { createRequire, SourceMap } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findConfig } from './find-config'
import { resolveSolutionAliases, type SolutionAliases } from './tsconfig-utils'
import type { BundleConfigResult, ConfigFileOptions } from './types'

const require = createRequire(import.meta.url)

/**
 * What each bundled file's `__dirname`, `__filename` and `import.meta` paths are rewritten to.
 *
 * Bundling puts every file the config imports into one module, so without this they would all
 * see the bundle's location — and a CommonJS bundle has no `import.meta` at all, which is why
 * `fileURLToPath(import.meta.url)` in a config used to fail. Each file is handed its own values
 * instead, under names nothing else uses.
 */
const DIRNAME = '__bamboo_injected_dirname'
const FILENAME = '__bamboo_injected_filename'
const IMPORT_META_URL = '__bamboo_injected_import_meta_url'

/**
 * A real `require` for an ES module bundle, resolving from the file bundled.
 *
 * The bundle inlines the CommonJS packages a config imports, as the CommonJS one always has, and
 * esbuild can only turn their `require()` of a built-in into a call that throws `Dynamic require
 * of "fs" is not supported` unless a `require` is in scope. It resolves from the file, not from
 * the temporary bundle: `require.resolve('./tokens.json')` and a dynamic `require` resolve where
 * they did when the CommonJS bundle was compiled as the file. esbuild renames a config's own
 * top-level `require` around this one, so `createRequire(import.meta.url)` in a config still works.
 */
const requireBanner = (file: string) =>
  `import { createRequire as __bamboo_createRequire } from 'node:module';` +
  `var require = __bamboo_createRequire(${JSON.stringify(pathToFileURL(file).href)});`

/**
 * Bundle a config — or a preset named by a string — and evaluate it, much as Vite loads
 * `vite.config.ts`.
 *
 * An ES module — `.mjs`/`.mts`, or a `.js`/`.ts` under `"type": "module"` — is bundled as ESM and
 * imported from a temporary file, so top-level `await` and `import.meta` work. Anything else is
 * bundled as CommonJS and compiled in place of the file, as before. Either way everything the file
 * imports is inlined, so the two load the same packages the same way.
 *
 * An error the config throws is the error reported. Loading used to fall back to `node-eval` on
 * any failure, which ran the config a second time and replaced the real error with that
 * fallback's own, `Please pass in filename to use require`.
 */
export async function bundle<T extends Config = Config>(filepath: string, cwd: string, options: BundleOptions = {}) {
  // A path, or a package name — a string preset is loaded through here too — resolved from `cwd`.
  const file = require.resolve(filepath, { paths: [cwd] })
  const esm = isEsmFile(file)
  const { code, dependencies } = await bundleFile(file, cwd, esm, options)

  let mod: any
  // Where the bundle ran from, as the stack names it: a temporary file, or the file itself.
  const loaded = { path: file }
  try {
    mod = esm ? await importBundled(file, code, loaded) : requireBundled(file, code)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // Where it threw is said if it can be, and never in place of what it threw.
    const where = await locate(
      error,
      loaded.path,
      async () => {
        // Bundled again for its source map, which nothing but an error reads. Code that differs from
        // what ran — a file saved since — would be read through a map that is not its own.
        const bundled = await bundleFile(file, cwd, esm, { ...options, sourcemap: true })
        return bundled.code === code ? bundled : undefined
      },
      cwd,
    ).catch(() => undefined)
    throw new BambooError('CONFIG_ERROR', `💥 Failed to load ${file}: ${reason}${where ? `\n    at ${where}` : ''}`, {
      cause: error,
    })
  }

  // A module with no default export is its exports, as `module.exports` is in a CommonJS one —
  // copied, since an ES module namespace cannot be written to and the config is. Only an object
  // is copied: spread, a function or `null` passed for a config with nothing in it.
  const exported = mod?.default !== undefined ? mod.default : mod
  const config = (exported === mod && typeof mod === 'object' && mod !== null ? { ...mod } : exported) as T

  return {
    config,
    dependencies,
  }
}

/** Whether Node would load `file` as an ES module. */
function isEsmFile(file: string): boolean {
  if (/\.m[jt]s$/.test(file)) return true
  if (/\.c[jt]s$/.test(file)) return false

  const manifest = findUp(dirname(file), (_dir, names) => names.includes('package.json') && 'package.json')
  if (!manifest) return false
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module'
  } catch {
    return false
  }
}

async function bundleFile(file: string, cwd: string, esm: boolean, options: BundleOptions & { sourcemap?: boolean }) {
  // esbuild reads each file under the tsconfig it finds walking up from it, which for one beside a
  // solution-style root declares no `paths`, so a config's alias imports resolved nowhere. See
  // `resolveSolutionAliases`.
  const aliases = options.projectReferences ? await resolveSolutionAliases(file, cwd) : undefined
  const injections = new Map<string, Injection>()
  const result = await build({
    absWorkingDir: cwd,
    entryPoints: [file],
    outfile: 'out.js',
    write: false,
    platform: 'node',
    target: [`node${process.versions.node}`],
    format: esm ? 'esm' : 'cjs',
    mainFields: ['module', 'main'],
    bundle: true,
    // Only to say where an error came from: see `locate`.
    sourcemap: options.sourcemap ? 'external' : false,
    sourcesContent: false,
    metafile: true,
    define: {
      __dirname: DIRNAME,
      __filename: FILENAME,
      'import.meta.url': IMPORT_META_URL,
      'import.meta.dirname': DIRNAME,
      'import.meta.filename': FILENAME,
    },
    ...(esm && { banner: { js: requireBanner(file) } }),
    plugins: [injectFileScopeVariables(injections), ...(aliases ? [resolveAliases(aliases)] : [])],
  })

  const output = (extension: string) => result.outputFiles.find((file) => file.path.endsWith(extension))
  return {
    code: output('.js')?.text ?? '',
    map: output('.map')?.text,
    injections,
    // The tsconfigs consulted too: an alias that moves, or a reference that appears, changes what
    // the config imports.
    dependencies: [
      ...(result.metafile ? Object.keys(result.metafile.inputs) : []),
      ...(aliases?.files() ?? []).map((path) => relative(cwd, path)),
    ],
  }
}

/**
 * Resolve the bare imports of the files esbuild reads under a solution-style root through the
 * aliases of their projects, each candidate as esbuild resolves a path — extensions, index files.
 * One none of them reach is left to esbuild, which looks in `node_modules`, as TypeScript does.
 */
function resolveAliases(aliases: SolutionAliases): Plugin {
  return {
    name: 'bamboo:solution-aliases',
    setup(build) {
      // Never a relative specifier: TypeScript reads `paths` for bare ones alone. Nor an absolute
      // one — every candidate is, so resolving one does not come back here.
      build.onResolve({ filter: /^[^.]/ }, async (args) => {
        if (args.namespace !== 'file' || !args.importer || isAbsolute(args.path)) return undefined
        for (const candidate of aliases.candidates(args.path, args.importer) ?? []) {
          const resolved = await build.resolve(candidate, {
            importer: args.importer,
            kind: args.kind,
            resolveDir: args.resolveDir,
          })
          if (resolved.errors.length) continue
          const { external, namespace, path, sideEffects, suffix } = resolved
          return { external, namespace, path, sideEffects, suffix }
        }
        return undefined
      })
    },
  }
}

interface BundleOptions {
  /**
   * Resolve the file's alias imports through a solution-style tsconfig's referenced projects. For
   * the config, which is the project's; not for a preset, which is a package's, and whose own
   * tsconfig esbuild finds from where it is.
   */
  projectReferences?: boolean
}

/**
 * What has to stay at the top of a file: a hashbang, then a directive prologue such as
 * `'use strict'`, comments around it included — a published package often opens with a licence
 * comment. Code in front of a directive turns it into an ordinary string, and a module that
 * relied on strict mode would run sloppy.
 *
 * A string is a directive only as a statement of its own, so one has to end at a `;`, or at a
 * line break that is not followed by something continuing it: `'a,b'` then `.split(',')` on the
 * next line is one expression, and splitting it would change what it means.
 */
const PROLOGUE =
  /^(?:#!.*\n)?(?:(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*(?:'[^'\\\n]*'|"[^"\\\n]*")[ \t]*(?:;|(?=\r?\n\s*(?![\s.,([`+\-*/%&|^?:<>=!]))))*/

/** Whether a file reads anything the injected variables stand in for. */
const NEEDS_SCOPE = /__dirname|__filename|import\.meta/

/**
 * Where a file had the variables put into a line of its own, so that a column the source map
 * reports there can be told back: esbuild maps the code it was handed, not the file.
 */
interface Injection {
  /** Zero-based. */
  line: number
  column: number
  length: number
}

/** Give each bundled file that reads them its own `__dirname`, `__filename` and `import.meta`. */
const injectFileScopeVariables = (injections: Map<string, Injection>): Plugin => ({
  name: 'bamboo:inject-file-scope-variables',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
      const contents = await readFile(args.path, 'utf8')
      // Handed back as read, so esbuild does not read it again: most of what a config inlines
      // reads none of them.
      if (!NEEDS_SCOPE.test(contents)) return { contents, loader: loaderFor(args.path) }
      const prologue = PROLOGUE.exec(contents)?.[0] ?? ''
      // A semicolon after a directive, so one written without cannot join it to what follows —
      // not a line break, which would move every line after it from where the file has it.
      const variables =
        (prologue && !prologue.endsWith('\n') ? ';' : '') +
        `var ${DIRNAME} = ${JSON.stringify(dirname(args.path))};` +
        `var ${FILENAME} = ${JSON.stringify(args.path)};` +
        `var ${IMPORT_META_URL} = ${JSON.stringify(pathToFileURL(args.path).href)};`
      const lineStart = prologue.lastIndexOf('\n') + 1
      injections.set(args.path, {
        line: prologue.split('\n').length - 1,
        column: prologue.length - lineStart,
        length: variables.length,
      })
      return {
        contents: `${prologue}${variables}${contents.slice(prologue.length)}`,
        loader: loaderFor(args.path),
      }
    })
  },
})

function loaderFor(file: string) {
  if (/\.[cm]?ts$/.test(file)) return 'ts' as const
  if (file.endsWith('.tsx')) return 'tsx' as const
  if (file.endsWith('.jsx')) return 'jsx' as const
  return 'js' as const
}

/**
 * Where an ES module bundle is written to be imported: `.bamboo` in the nearest `node_modules`.
 *
 * Not beside the config, where a watcher or an `include` glob would see it come and go — both
 * leave `node_modules` alone — and a module runner such as vitest's hands a file under it to
 * Node rather than resolving it itself. Without one — Yarn PnP, say — the system's temporary
 * directory, rather than a `node_modules` made for the purpose. The banner's `require` resolves
 * from the file bundled, wherever this is; what resolves from here is an `import()` whose
 * specifier esbuild could not read, and `import.meta.resolve`.
 */
function bundleDirFor(file: string): string {
  const modules = findUp(dirname(file), (_dir, names) => names.includes('node_modules') && 'node_modules')
  return modules ? join(modules, '.bamboo') : tmpdir()
}

/**
 * Import an ES module bundle from a temporary file.
 *
 * The name is unique to the load, so a changed config is never answered from Node's module
 * cache, and starts with the file's own name, so a stack through it reads as that file's. The
 * cost, shared with Vite's own config loader, is that a long session keeps each version it
 * loaded: ES modules cannot be evicted. A watching build reloads only a config whose files
 * changed (`Builder.setup`), as a dev server does, so it keeps a version per edit, not per
 * rebuild.
 */
async function importBundled(file: string, code: string, loaded: { path: string }) {
  const name = `${basename(file)}.timestamp-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.mjs`
  const dir = bundleDirFor(file)
  let temp = join(dir, name)
  try {
    writeTemp(temp, code)
    sweepStale(dir)
  } catch {
    temp = join(tmpdir(), name)
    writeTemp(temp, code)
  }
  loaded.path = temp
  try {
    return await import(pathToFileURL(temp).href)
  } finally {
    try {
      unlinkSync(temp)
    } catch {
      // Already gone: nothing is left to clean up.
    }
  }
}

function writeTemp(file: string, code: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, code)
}

const STALE_BUNDLE = /\.timestamp-\d+-[0-9a-f]+\.mjs$/
const swept = new Set<string>()

/**
 * Remove the bundles a load left in `dir` without finishing — a process stopped while a config
 * awaited something — once they are an hour old, so as not to take one a running load has yet to
 * import. Once per directory a process: a stopped load is the only way one is left behind.
 */
function sweepStale(dir: string) {
  if (swept.has(dir)) return
  swept.add(dir)
  const before = Date.now() - 3_600_000
  try {
    for (const name of readdirSync(dir)) {
      if (!STALE_BUNDLE.test(name)) continue
      const path = join(dir, name)
      if (statSync(path).mtimeMs < before) unlinkSync(path)
    }
  } catch {
    // Taken by another process's sweep, or the directory gone: nothing to do.
  }
}

/**
 * Compile a CommonJS bundle as the file itself, so its `require` resolves from there: a module of
 * its own, rather than a hook on `require.extensions` matched by path, which missed the file where
 * the loader and `realpathSync.native` spelled it differently — a Windows `subst` drive, a
 * junction — and compiled the source as JavaScript.
 */
function requireBundled(file: string, code: string) {
  const module = new Module(file) as Module & { _compile(code: string, filename: string): void }
  module.filename = file
  module.paths = (Module as unknown as { _nodeModulePaths(from: string): string[] })._nodeModulePaths(dirname(file))
  module._compile(code, file)
  return module.exports
}

/**
 * Where in the source an error the bundle threw came from: its first frame in the bundle, read back
 * through the bundle's source map. The stack names the bundle — a temporary file, or the file the
 * CommonJS bundle was compiled as — at the bundle's lines, which say nothing to whoever wrote it.
 */
async function locate(
  error: unknown,
  bundled: string,
  rebundle: () => Promise<{ map?: string; injections: Map<string, Injection> } | undefined>,
  cwd: string,
): Promise<string | undefined> {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return undefined
  // As V8 writes a frame: an ES module by its URL, a CommonJS one by its path, either of which may
  // hold a space, then a line and a column, and a closing parenthesis if the frame named a function.
  const names = [pathToFileURL(bundled).href, bundled]
  for (const frame of error.stack.split('\n')) {
    const text = frame.trim()
    const name = names.find((name) => text.includes(`${name}:`))
    const position = name && /^:(\d+):(\d+)\)?$/.exec(text.slice(text.lastIndexOf(`${name}:`) + name.length))
    if (!position) continue
    const { map, injections } = (await rebundle()) ?? {}
    if (!map || !injections) return undefined
    const entry = new SourceMap(JSON.parse(map)).findEntry(Number(position[1]) - 1, Number(position[2]) - 1)
    if (!('originalSource' in entry) || !entry.originalSource) return undefined
    // esbuild names each source relative to where the bundle would have been written: `cwd`.
    const source = resolve(cwd, entry.originalSource)
    const injected = injections.get(source)
    const shifted = injected?.line === entry.originalLine && entry.originalColumn >= injected.column
    const column = shifted ? Math.max(injected.column, entry.originalColumn - injected.length) : entry.originalColumn
    return `${source}:${entry.originalLine + 1}:${column + 1}`
  }
  return undefined
}

export async function bundleConfig(options: ConfigFileOptions): Promise<BundleConfigResult> {
  const { cwd, file } = options

  const filePath = findConfig({ cwd, file })

  logger.debug('config:path', filePath)

  const result = await bundle(filePath, cwd, { projectReferences: true })

  if (typeof result.config !== 'object' || result.config === null) {
    throw new BambooError('CONFIG_ERROR', `💥 Config must export or return an object.`)
  }

  result.config.outdir ??= 'styled-system'
  result.config.validation ??= 'warn'

  return {
    ...result,
    config: result.config,
    path: filePath,
  }
}
