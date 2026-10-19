import type { ParserOptions } from '@bamboocss/core'
import type { AnalysisReport, ParserResultInterface, PropertyReportItem } from '@bamboocss/types'

/**
 * Usage of what a design system defines besides tokens and recipes: its patterns, the utilities
 * styles are written with, and its keyframes. What an audit is after is as much what goes unused
 * as what is used, so every pattern and keyframe the config defines is listed, at a count of
 * nothing when nothing calls it.
 */

export interface PatternReportEntry {
  patternName: string
  usedCount: number
  usedInXFiles: number
  /**
   * Whether nothing uses it, `staticCss` included, which a count of calls cannot say: a pattern
   * `staticCss` emits is used with no call at all. Set when the report is read through `analyze`.
   */
  unused?: boolean
}

export interface UtilityReportEntry {
  /**
   * The style property, a shorthand counted as the property it stands for — `bg` as `background`
   * — and those a pattern's transform writes included.
   */
  propName: string
  usedCount: number
  usedInXFiles: number
}

export interface KeyframeReportEntry {
  keyframe: string
  /** How many `animation` and `animationName` values name it, directly or through an `animations` token. */
  usedCount: number
  usedInXFiles: number
  /**
   * Whether the build's prune removes it, which a count of values cannot say: keyframes reached
   * through a semantic token, a mixin or `global.css` are used at a count of nothing. Set when the
   * report is read through `analyze`.
   */
  unused?: boolean
}

const byUse = <T extends { usedCount: number }>(entries: T[]) => entries.sort((a, b) => b.usedCount - a.usedCount)

/**
 * From the extraction rather than the classified report, which reads a pattern call as the `css`
 * call it expands to and keeps no name for it.
 */
export function analyzePatterns(
  ctx: ParserOptions,
  parserResults: ReadonlyMap<string, ParserResultInterface>,
): PatternReportEntry[] {
  const names = ctx.patterns.keys
  const calls = new Map<string, { count: number; files: Set<string> }>(
    names.map((name) => [name, { count: 0, files: new Set() }]),
  )

  // Keyed by the name the pattern is exported as, which is its name in the config.
  for (const [filepath, result] of parserResults) {
    for (const [called, items] of result.pattern) {
      const usage = calls.get(called)
      if (!usage) continue
      usage.count += items.size
      usage.files.add(filepath)
    }
  }

  return byUse(
    Array.from(calls, ([patternName, { count, files }]) => ({
      patternName,
      usedCount: count,
      usedInXFiles: files.size,
    })),
  )
}

/** The values written for `propName`. */
const valuesOf = (result: AnalysisReport, propName: string) =>
  Array.from(result.derived.globalMaps.byPropertyName.get(propName) ?? [], (index) =>
    result.propByIndex.get(index),
  ).filter((item): item is PropertyReportItem => item !== undefined)

/** The source files among `filepaths`: not the config's recipes and global CSS, which count as uses. */
const sourceFiles = (filepaths: Iterable<string>) =>
  new Set(Array.from(filepaths).filter((filepath) => !filepath.startsWith('@config'))).size

/** `isProperty` keeps what is a style property, and not a key nothing styles — a typo, say. */
export function analyzeUtilities(result: AnalysisReport, isProperty: (name: string) => boolean): UtilityReportEntry[] {
  return byUse(
    Array.from(result.derived.globalMaps.byPropertyName.keys())
      .filter(isProperty)
      .map((propName) => {
        const items = valuesOf(result, propName)
        return { propName, usedCount: items.length, usedInXFiles: sourceFiles(items.map((item) => item.filepath)) }
      }),
  )
}

const ANIMATION_PROPERTIES = ['animation', 'animationName']

export function analyzeKeyframes(ctx: ParserOptions, result: AnalysisReport): KeyframeReportEntry[] {
  const names = Object.keys(ctx.config.theme?.keyframes ?? {})
  const usage = new Map<string, { count: number; files: Set<string> }>(
    names.map((name) => [name, { count: 0, files: new Set() }]),
  )

  // A keyframe is named in the value — `spin 1s linear` — or in an `animations` token the value
  // is the name of, or reads through `token()`, whose path ends at a comma.
  const tokenValue = (path: string) => String(ctx.tokens.getByName(path.split(',')[0]!.trim())?.value ?? '')
  const named = (item: PropertyReportItem) => {
    const value = String(item.value)
    const texts = [
      value.replace(/token\(([^()]+)\)/g, (_, path: string) => tokenValue(path)),
      tokenValue(`animations.${value}`),
    ]
    return new Set(texts.flatMap((text) => text.split(/[\s,]+/)))
  }

  for (const propName of ANIMATION_PROPERTIES) {
    for (const item of valuesOf(result, propName)) {
      for (const name of named(item)) {
        const entry = usage.get(name)
        if (!entry) continue
        entry.count++
        entry.files.add(item.filepath)
      }
    }
  }

  return byUse(
    Array.from(usage, ([keyframe, { count, files }]) => ({
      keyframe,
      usedCount: count,
      usedInXFiles: sourceFiles(files),
    })),
  )
}
