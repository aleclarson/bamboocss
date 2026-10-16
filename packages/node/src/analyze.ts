import { logger } from '@bamboocss/logger'
import type { ReportFormat } from '@bamboocss/reporter'
import type { AnalysisOptions, ParserResultInterface } from '@bamboocss/types'
import { assembleExtractedSheet } from './assemble-sheet'
import type { BambooContext } from './create-context'
import type { ParserResult } from './parser-result'

/** The configured names no source uses, by what they are. */
export interface UnusedNames {
  tokens: string[]
  recipes: string[]
  patterns: string[]
  keyframes: string[]
}

/**
 * `analyze` is one CLI command, but this module is reachable from `@bamboocss/node`'s index,
 * so a static import made every consumer of that index — the CLI on any command, and the Vite
 * plugin on every build — load the reporter and its table formatters to run neither. Loading
 * it here keeps that off the path of everything that is not the `analyze` command.
 */
export async function analyze(ctx: BambooContext, options: AnalysisOptions = {}) {
  const { Reporter, formatRecipeReport, formatTokenReport } = await import('@bamboocss/reporter')

  // The CLI runs as CommonJS and loads the reporter, here, as an ES module, which logs through
  // the logger's ES build: another instance, at a level of its own. `--silent` quieted the CLI's,
  // and the reporter said what it was analyzing regardless.
  const { logger: reporterLogger } = await import('@bamboocss/logger')
  reporterLogger.level = logger.level

  // The build's extraction — Rust — rather than a second, TypeScript one. The report used to
  // extract every file again through the TypeScript engine, which could disagree with what the
  // build actually emitted, and started the Go compiler to do it.
  const parserResults: ParserResultInterface[] = []
  const reporter = new Reporter(ctx, {
    parserOptions: ctx.parserOptions,
    parseFile: (file) => ctx.parseFile(file),
    prepare: (files) => ctx.prepareNativeExtraction(files),
    getRelativePath: ctx.runtime.path.relative,
    getFiles: ctx.getFiles,
    ...options,
    onResult: (file, result) => {
      parserResults.push(result)
      options.onResult?.(file, result)
    },
  })

  reporter.init()

  const writeJson = (filePath: string, value: unknown) => {
    ctx.runtime.fs.ensureDirSync(ctx.runtime.path.dirname(filePath))
    return ctx.runtime.fs.writeFile(filePath, JSON.stringify(value, replacer, 2))
  }

  return {
    getRecipeReport(format: ReportFormat = 'table') {
      const report = reporter.getRecipeReport()
      return { report, formatted: formatRecipeReport(report, format) }
    },
    getTokenReport(format: ReportFormat = 'table') {
      const report = reporter.getTokenReport()
      return { report, formatted: formatTokenReport(report.getSummary(), format) }
    },
    /** Every pattern the config defines, and how often each is called. */
    getPatternReport: () => reporter.getPatternReport(),
    /** Every style property written, and how often. */
    getUtilityReport: () => reporter.getUtilityReport(),
    /** Every keyframe the theme defines, and how often an animation names it. */
    getKeyframeReport: () => reporter.getKeyframeReport(),
    /**
     * The configured names no source uses, of the kinds asked for.
     *
     * Tokens and keyframes are what the build's own prune removes, run with every prune on
     * whatever the config says, so a name here is one the stylesheet already ships without.
     * Anything the prune keeps for a reader it cannot follow — a `token()` path built at runtime,
     * a theme, a `keepTokens` pattern — is kept here too, and not listed: being told a token is
     * unused when something still asks for it is worse than not being told at all. A recipe or a
     * pattern is one no source calls and `staticCss` does not emit regardless.
     *
     * Read off a sheet of its own. The prune's settings are laid over the context's while it is
     * built, and `unresolvedPath` is off for it: that one only decides how loudly the prune says
     * what it could not read, and a project that does not prune tokens never hears it.
     */
    getUnused(kinds: ReadonlyArray<keyof UnusedNames> = ['tokens', 'recipes', 'patterns', 'keyframes']): UnusedNames {
      const unused: UnusedNames = { tokens: [], recipes: [], patterns: [], keyframes: [] }

      if (kinds.includes('tokens') || kinds.includes('keyframes')) {
        const prune = { ...ctx.config.prune, keyframes: true, unresolvedPath: 'off' as const }
        if (prune.tokens === false) delete prune.tokens
        const configured = ctx.config.prune
        ctx.config.prune = prune
        let sheet: ReturnType<typeof assembleExtractedSheet>
        try {
          sheet = assembleExtractedSheet(ctx, {
            parserResults: parserResults as ParserResult[],
            prunePreflight: false,
          })
        } finally {
          ctx.config.prune = configured
        }

        const declared = new Set<string>()
        const keyframes = new Set<string>()
        sheet.layers.tokens.walkDecls((decl) => {
          if (decl.prop.startsWith('--')) declared.add(decl.prop)
        })
        // As the name, which css may quote or escape: `"fade in"`, `fade\.in`.
        sheet.layers.tokens.walkAtRules(/keyframes$/, (rule) => {
          keyframes.add(
            rule.params
              .trim()
              .replace(/^(["'])(.*)\1$/, '$2')
              .replace(/\\(.)/g, '$1'),
          )
        })

        const declarable = new Set<string>()
        for (const vars of ctx.tokens.view.vars.values()) for (const name of vars.keys()) declarable.add(name)
        const tokens = new Set<string>()
        for (const token of ctx.tokens.allTokens) {
          // Generated rather than configured: a palette's virtual tokens and a theme's, the negatives
          // of a scale, and the tokens each breakpoint is written as, which a condition reads by value.
          const { isVirtual, isNegative, category } = token.extensions
          if (isVirtual || isNegative || category === 'breakpoints' || token.name.startsWith('sizes.breakpoint-'))
            continue
          const name = token.extensions.var
          if (declarable.has(name) && !declared.has(name)) tokens.add(token.name)
        }

        if (kinds.includes('tokens')) unused.tokens = [...tokens].sort()
        if (kinds.includes('keyframes')) {
          unused.keyframes = Object.keys(ctx.config.theme?.keyframes ?? {})
            .filter((name) => !keyframes.has(name))
            .sort()
        }
      }

      // Emitted for a consumer outside `include`, which no scan here can see calling them.
      const { staticCss } = ctx.config
      const emitted = (rules: unknown) => (name: string) =>
        rules === '*' || (rules != null && typeof rules === 'object' && name in rules)

      if (kinds.includes('recipes')) {
        const called = new Set(reporter.getRecipeReport().map((entry) => entry.recipeName))
        const inConfig = emitted(staticCss?.recipes)
        // And by its own `staticCss`, as a recipe's config can ask.
        const { recipes = {}, slotRecipes = {} } = ctx.config.theme ?? {}
        const ofItself = (name: string) => Boolean((recipes[name] ?? slotRecipes[name])?.staticCss?.length)
        unused.recipes = [...ctx.recipes.keys]
          .filter((name) => !called.has(name) && !inConfig(name) && !ofItself(name))
          .sort()
      }
      if (kinds.includes('patterns')) {
        const kept = emitted(staticCss?.patterns)
        unused.patterns = reporter
          .getPatternReport()
          .filter((entry) => !entry.usedCount && !kept(entry.patternName))
          .map((entry) => entry.patternName)
          .sort()
      }

      return unused
    },
    /** The names as JSON, of the kinds `getUnused` was asked for. */
    writeUnused(filePath: string, unused: Partial<UnusedNames>) {
      return writeJson(filePath, unused)
    },
    writeReport(filePath: string) {
      return writeJson(filePath, reporter.report)
    },
  }
}

function replacer(_: string, value: any) {
  if (value instanceof Set) return Array.from(value)
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}
