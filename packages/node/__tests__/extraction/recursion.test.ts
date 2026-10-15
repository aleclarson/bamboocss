import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

/**
 * A recursive style helper the stylesheet pass cannot see the end of.
 *
 * On a value the build cannot read, `nest(props.depth)` never reaches its base case, and
 * following it overflowed the native stack: the process exited with a segfault, no message and no
 * stylesheet. It is refused like any other code the evaluator does not run, and gives nothing: the
 * levels it went through before the refusal are not what the helper returns, so none of them
 * reaches the sheet.
 */
const extract = (body: string) => parseAndExtract(`import { css } from 'styled-system/css'\n${body}\n`)

describe('a recursive helper', () => {
  test('on a value the build cannot read is refused, not followed until the stack runs out', () => {
    const result = extract(
      `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1), color: 'red.300' } : {})\n` +
        `export const f = (props) => css(nest(props.depth))`,
    )

    expect(result.json).toMatchObject([{ name: 'css' }])
    expect(result.css).toBe('')
  })

  test('that branches is refused as surely', () => {
    const result = extract(
      `const tree = (d) => (d > 0 ? { '& > a': tree(d - 1), '& > b': tree(d - 1) } : { color: 'red.300' })\n` +
        `export const f = (props) => css(tree(props.depth))`,
    )

    expect(result.json).toMatchObject([{ name: 'css' }])
    expect(result.css).toBe('')
  })

  test('that never ends leaves nothing of the levels it went through', () => {
    // Its arguments change at every level, so it is followed as deep as the evaluator goes.
    const result = extract(
      `const deeper = (d) => ({ '& > div': deeper(d + 1), color: 'red.300' })\nexport const A = css(deeper(0))`,
    )

    expect(result.css).toBe('')
  })

  test('past the depth, leaves nothing of the recursion, whichever helper it had reached', () => {
    // The call past the depth is `leaf`, which is not the recursion; every level of `walk` goes.
    const result = extract(
      `const leaf = () => ({ color: 'red.300' })\n` +
        `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1), color: 'blue.500' } : leaf())\n` +
        `export const A = css(walk(63))`,
    )

    expect(result.css).toBe('')
  })

  test('leaves what is around it alone', () => {
    const result = extract(
      `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : {})\n` +
        `export const f = (props) => css({ color: 'red.300', ...nest(props.depth) })`,
    )

    expect(result.css).toContain('color: var(--colors-red-300)')
    expect(result.css).not.toContain('> div')
  })

  test('that ends is followed to its end', () => {
    const result = extract(
      `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const A = css(nest(2))`,
    )

    expect(result.css).toContain('color: var(--colors-red-300)')
    expect(result.css).toMatch(/> div > div/)
  })
})
