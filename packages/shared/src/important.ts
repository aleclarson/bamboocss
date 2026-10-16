import { FALLBACK_SEPARATOR, parseFallbackValue } from './fallback-value'

const IMPORTANT = 'important'
const BANG = 0x21
const STAR = 0x2a
const SLASH = 0x2f
const BACKSLASH = 0x5c
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const whitespaceRegex = /\s/

/**
 * Where the important mark ending `value` — read up to `end` — starts, or -1.
 *
 * A mark is a `!`, then optionally whitespace and the keyword in any case, then only whitespace.
 * Only one that ends the value counts. Any `!` used to — the one in `content: '"!"'`, in a quoted
 * font name, in an SVG data URI's `<!--` — and it was cut out of the value as the declaration was
 * marked: `content: "" !important`.
 *
 * Whitespace is any run of it, not only CSS's: the build writes each run as one space, so
 * `red !\u00a0important` reaches the browser as `red ! important`, a mark. Read as CSS's alone,
 * the class was named for an ordinary declaration and the rule for an important one. A comment
 * is whitespace to CSS, before the keyword or after it. An escaped `\!` is no mark: it is part
 * of the identifier before it.
 *
 * Read from the end, so finding one costs the whitespace around the keyword and its nine
 * characters, and stripping a run of them is linear however long the value is.
 */
function markAt(value: string, end = value.length): number {
  end = beforeTrivia(value, end)
  if (end > 0 && value.charCodeAt(end - 1) === BANG) return isEscaped(value, end - 1) ? -1 : end - 1
  const keyword = end - IMPORTANT.length
  if (keyword <= 0 || !isKeyword(value, keyword)) return -1
  const bang = beforeTrivia(value, keyword)
  return bang > 0 && value.charCodeAt(bang - 1) === BANG && !isEscaped(value, bang - 1) ? bang - 1 : -1
}

/** Where the whitespace and comments that end `value` before `end` begin. */
function beforeTrivia(value: string, end: number): number {
  for (;;) {
    while (end > 0 && isWhitespace(value.charCodeAt(end - 1))) end--
    // `/* … */`, whose opening `*` cannot be its closing one: `/*/` is no comment.
    if (end < 4 || value.charCodeAt(end - 1) !== SLASH || value.charCodeAt(end - 2) !== STAR) return end
    const open = value.lastIndexOf('/*', end - 4)
    if (open === -1) return end
    end = open
  }
}

/** Whether the character at `at` follows an odd run of backslashes, which escapes it. */
function isEscaped(value: string, at: number): boolean {
  let backslashes = 0
  while (at - backslashes > 0 && value.charCodeAt(at - backslashes - 1) === BACKSLASH) backslashes++
  return backslashes % 2 === 1
}

/** What `trim` removes: WhiteSpace and LineTerminator, the set `\s` matches. */
function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}

/** Whether `important` starts at `from`, in any case. ASCII only, so setting bit 5 lowercases. */
function isKeyword(value: string, from: number): boolean {
  for (let index = 0; index < IMPORTANT.length; index++) {
    if ((value.charCodeAt(from + index) | 0x20) !== IMPORTANT.charCodeAt(index)) return false
  }
  return true
}

/** `value` without the marks that end it — every one, so `red !important !important` is `red`. */
function stripMarks(value: string): string {
  let end = value.length
  for (let at = markAt(value, end); at !== -1; at = markAt(value, end)) end = at
  return (end === value.length ? value : value.slice(0, end)).trim()
}

/**
 * Whether `value` is an arbitrary value, `[absolute!]`, whose brackets hold the mark.
 *
 * The escape hatch keeps its contents as written, so the mark sits inside it. Its brackets are
 * the whole value: `[a] 1fr [b!]` is two line names and a track, and its `!` is no mark. Expects
 * a trimmed value, which `stripMarks` returns.
 */
function isMarkedArbitrary(value: string): boolean {
  const close = value.length - 1
  return (
    close > 0 &&
    value.charCodeAt(0) === OPEN_BRACKET &&
    value.charCodeAt(close) === CLOSE_BRACKET &&
    closingBracket(value) === close &&
    markAt(value, close) !== -1
  )
}

/** Where the bracket opening `value` closes, or -1. */
function closingBracket(value: string): number {
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === OPEN_BRACKET) depth++
    else if (code === CLOSE_BRACKET && --depth === 0) return index
  }
  return -1
}

/** Whether a mark ends `value`, or an escape hatch that is the whole of it holds one. */
function isMarked(value: string): boolean {
  return markAt(value) !== -1 || isMarkedArbitrary(value.trim())
}

/** `value` without the marks that end it, nor the one inside an escape hatch that is all of it. */
function unmarked(value: string): string {
  const stripped = stripMarks(value)
  return isMarkedArbitrary(stripped) ? `[${stripMarks(stripped.slice(1, -1))}]` : stripped
}

/**
 * The candidates of a `fallback(...)` value one of which ends in a mark, or `undefined`.
 *
 * `fallback(red !important, blue)` marks the declaration as `fallback(red, blue)!` does:
 * `markImportant` then puts the mark on every candidate, which is what a fallback needs — a
 * browser falling back to the unmarked one would otherwise lose an important-priority fight.
 * Reached only for a value holding a `!`, and `parseFallbackValue` rejects anything that is
 * not a fallback call before it allocates.
 */
function markedFallback(value: string): string[] | undefined {
  const candidates = parseFallbackValue(value)
  return candidates?.some(isMarked) ? candidates : undefined
}

// The four below run per style leaf on every `css()` cache miss, and for the values that
// dominate real style objects — `red`, `4px`, `lg` — all four are no-ops. Each is guarded by
// the cheapest search that can prove it has nothing to do, so a plain token pays a scan
// rather than a regex rewrite.
//
// The guards are exact rather than approximate, which is the only reason they are safe:
//
// - A mark cannot exist without a literal `!`. Its absence rules out `isImportant` and the
//   stripping half of `withoutImportant`, but not the `trim`, which still has to run.
// - `/\s/` is exactly the class `[\n\s]+` matches; `\n` is already a member. `\s` is a fixed
//   spec-defined set rather than a Unicode property, so the missing `u` flag changes nothing.
//   It includes U+FEFF and excludes U+200B, and a guard that got either wrong would be silent.
// - `trim()` strips WhiteSpace ∪ LineTerminator, the same set again.

/**
 * Collapse every run of whitespace to a single space, which is what the class name is
 * built from. Exported because `leafClass` has to reproduce this exact pipeline, and a
 * second copy of it would be free to drift from the one `createCss` runs.
 */
export function sanitize<T>(value: T): T {
  if (typeof value !== 'string') return value
  const collapsed = whitespaceRegex.test(value) ? value.replaceAll(/[\n\s]+/g, ' ') : value
  // NUL is what a `fallback(...)` joins its candidates with on the way to `stringify`. It
  // cannot appear in CSS, but it can appear in a JS string, and one arriving from pasted or
  // generated content would be split into declarations nobody wrote — and would put a raw
  // NUL in the class name, which the CSS parser rewrites to U+FFFD so the rule stops
  // matching the element. Author values never carry it past here.
  return (collapsed.includes(FALLBACK_SEPARATOR) ? collapsed.replaceAll(FALLBACK_SEPARATOR, '') : collapsed) as T
}

export function isImportant<T extends string | number | boolean>(value: T) {
  if (typeof value !== 'string' || !value.includes('!')) return false
  return isMarked(value) || markedFallback(value.trim()) !== undefined
}

/**
 * The mark that makes `value` important, as written — `!important`, `! IMPORTANT`, `!` — or
 * `undefined` when `isImportant` would say it is not. The one `withoutImportant` removes, found
 * where it does: ending the value, inside an escape hatch's brackets, or ending a fallback's
 * candidate. For a message quoting it back; not on any per-leaf path.
 */
export function importantMark(value: string): string | undefined {
  if (!value.includes('!')) return undefined
  const trimmed = value.trim()
  const own = markOf(trimmed)
  if (own !== undefined) return own
  const candidate = markedFallback(trimmed)?.find(isMarked)
  return candidate === undefined ? undefined : markOf(candidate.trim())
}

/** The mark ending a trimmed `value`, or the one inside an escape hatch that is all of it. */
function markOf(value: string): string | undefined {
  const at = markAt(value)
  if (at !== -1) return value.slice(at, beforeTrivia(value, value.length))
  if (!isMarkedArbitrary(value)) return undefined
  const close = value.length - 1
  return value.slice(markAt(value, close), beforeTrivia(value, close)).trim()
}

// `string | T` is stated rather than inferred: `T` is a literal type at most call sites, and
// letting these return `T` would promise the caller back the string it passed while handing
// it a rewritten one.
export function withoutImportant<T extends string | number | boolean>(value: T): string | T {
  if (typeof value !== 'string') return value
  if (!value.includes('!')) return value.trim()
  const stripped = stripMarks(value)
  // The common case, `red !important`: nothing left that a bracket or a candidate could hold.
  if (!stripped.includes('!')) return stripped
  if (isMarkedArbitrary(stripped)) return `[${stripMarks(stripped.slice(1, -1))}]`
  const candidates = markedFallback(stripped)
  return candidates ? `fallback(${candidates.map(unmarked).join(', ')})` : stripped
}

export function withoutSpace<T extends string | number | boolean>(str: T): string | T {
  if (typeof str !== 'string') return str
  return str.includes(' ') ? str.replaceAll(' ', '_') : str
}

type Dict = Record<string, unknown>

export function markImportant(obj: Dict) {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  const result = Array.isArray(obj) ? [] : {}
  const stack = [{ obj, result }] as { obj: Dict; result: Dict }[]

  while (stack.length > 0) {
    const { obj, result } = stack.pop()!
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.includes(FALLBACK_SEPARATOR)) {
        // Every candidate of a fallback carries the mark, not just the last one. Marking
        // only the winning declaration would leave the others losing an important-priority
        // fight in exactly the browsers that have to fall back to them.
        result[key] = value
          .split(FALLBACK_SEPARATOR)
          .map((candidate) => `${candidate} !important`)
          .join(FALLBACK_SEPARATOR)
      } else if (typeof value === 'string' || typeof value === 'number') {
        result[key] = `${value} !important`
      } else if (typeof value === 'object' && value !== null) {
        const next = Array.isArray(value) ? [] : {}
        result[key] = next
        stack.push({ obj: value as Dict, result: next })
      } else {
        result[key] = value
      }
    }
  }

  return result
}
