/**
 * Whether every `&` in a selector names its parent and every `,` separates it: one with no quote
 * to hold either, and no escape — nearly every selector, which is what lets the rest answer it
 * without walking it.
 */
const isPlain = (selector: string) => !selector.includes('"') && !selector.includes("'") && !selector.includes('\\')

/**
 * Each character of a selector that is its syntax — outside a quoted attribute value, where it is
 * the value's own, and not escaped — with how deep in parentheses it is.
 *
 * A string ends at its closing quote, or at the end of its line, where css ends one left open.
 */
const forEachSyntactic = (selector: string, visit: (char: string, at: number, depth: number) => void) => {
  let quote: string | undefined
  let depth = 0
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]!
    if (char === '\\') i++
    else if (quote) {
      if (char === quote || char === '\n') quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else {
      if (char === '(') depth++
      else if (char === ')') depth--
      visit(char, i, depth)
    }
  }
}

/**
 * Where a selector names its parent: each `&` that is its syntax.
 *
 * Every `&` was taken for the parent, so `&[data-label="a & b"]` had the parent's class written
 * into the value it matches against, and the rule matched nothing.
 */
export const parentReferences = (selector: string): number[] => {
  if (!isPlain(selector)) return syntacticReferences(selector)
  const at: number[] = []
  for (let i = selector.indexOf('&'); i !== -1; i = selector.indexOf('&', i + 1)) at.push(i)
  return at
}

const syntacticReferences = (selector: string) => {
  const at: number[] = []
  forEachSyntactic(selector, (char, i) => {
    if (char === '&') at.push(i)
  })
  return at
}

/**
 * Whether two references to the parent share a line, as `/&.*&/` asked of a selector before any
 * of this — `.` crossing no line — which decides whether a parent with a combinator is wrapped in
 * `:is()`. Kept as it was read, so a selector reads the same as it did.
 */
export const sharesLine = (selector: string, at: number[]) => {
  for (let i = 1; i < at.length; i++) if (!LINE_BREAK.test(selector.slice(at[i - 1], at[i]))) return true
  return false
}

/** What a regular expression's `.` does not cross. */
const LINE_BREAK = /[\n\r\u2028\u2029]/

/** Whether the character at `index` is escaped: after an odd run of backslashes. */
const isEscaped = (selector: string, index: number) => {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && selector[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

/**
 * The selectors a list holds, split at each comma that is its syntax: not one in parentheses, an
 * argument to `:is()`, nor one in a quoted value, `[data-label="a, b"]`, which split the selector
 * there.
 */
export const splitSelectors = (selector: string): string[] => {
  const commas: number[] = []
  if (isPlain(selector)) {
    let depth = 0
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i]
      if (char === '(') depth++
      else if (char === ')') depth--
      else if (char === ',' && depth === 0) commas.push(i)
    }
  } else {
    forEachSyntactic(selector, (char, i, depth) => {
      if (char === ',' && depth === 0) commas.push(i)
    })
  }
  const result: string[] = []
  let from = 0
  for (const at of commas) {
    result.push(selector.slice(from, at).trim())
    from = at + 1
  }
  const last = selector.slice(from)
  if (last) result.push(last.trim())
  return result
}

/** `selector` with each `&` naming its parent written as `parent`, as it is, `$` and all. */
export const replaceParent = (selector: string, parent: string, at = parentReferences(selector)) => {
  let replaced = ''
  let from = 0
  for (const index of at) {
    replaced += selector.slice(from, index) + parent
    from = index + 1
  }
  return replaced + selector.slice(from)
}

/** `selector` without the first of its references to a parent that `matches`, and what it takes with it. */
const without = (selector: string, matches: (at: number) => [number, number] | undefined, every: boolean) => {
  let removed = ''
  let from = 0
  for (const at of syntacticReferences(selector)) {
    const span = matches(at)
    if (!span) continue
    removed += selector.slice(from, span[0])
    from = span[1]
    if (!every) break
  }
  return removed + selector.slice(from)
}

/** A selector without the first `& ` naming a parent, where nothing is above it to be one. */
export const withoutParentSpace = (selector: string) =>
  isPlain(selector)
    ? selector.replace('& ', '')
    : without(selector, (at) => (selector[at + 1] === ' ' ? [at, at + 2] : undefined), false)

/** A selector without the first `&` naming a parent. */
export const withoutFirstParent = (selector: string) =>
  isPlain(selector) ? selector.replace('&', '') : without(selector, (at) => [at, at + 1], false)

/** A selector without any `&` naming a parent. */
export const withoutParents = (selector: string) =>
  isPlain(selector) ? selector.replaceAll('&', '') : without(selector, (at) => [at, at + 1], true)

/** A selector without each ` &` — a parent named after a space — that nests it under one. */
export const withoutParentNesting = (selector: string) =>
  isPlain(selector)
    ? selector.replace(/\s&/g, '')
    : without(
        selector,
        (at) => (/\s/.test(selector[at - 1] ?? '') && !isEscaped(selector, at - 1) ? [at - 1, at + 1] : undefined),
        true,
      )
