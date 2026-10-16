import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

/**
 * `+` in a style value, as the stylesheet pass reads it.
 *
 * It used to concatenate whatever the operands were, so `base + 1` extracted as `101` and the
 * stylesheet carried `z-index: 101`. The Vite fold reads the same evaluation, so the class agreed
 * with the rule and neither agreed with the source; `fold-known-values.test.ts` pins the class.
 */
const extract = (body: string) => parseAndExtract(`import { css } from 'styled-system/css'\n${body}\n`)

describe('`+` in a style value', () => {
  test.each([
    ['two numbers add', `const base = 10\ncss({ zIndex: base + 1 })`, { zIndex: 11 }, 'z-index: 11'],
    ['inside a template literal', 'css({ width: `${2 + 3}px` })', { width: '5px' }, 'width: 5px'],
    ['a boolean adds as a number', `const raised = true\ncss({ zIndex: raised + 1 })`, { zIndex: 2 }, 'z-index: 2'],
    ['a string operand concatenates', `const unit = 'px'\ncss({ width: 4 + unit })`, { width: '4px' }, 'width: 4px'],
    [
      'a numeric string concatenates',
      `const base = '10'\ncss({ zIndex: base + 1 })`,
      { zIndex: '101' },
      'z-index: 101',
    ],
    [
      'an array joins with empty holes',
      `const areas = ['a', , 'b']\ncss({ gridArea: areas + '' })`,
      { gridArea: 'a,,b' },
      'grid-area: a,,b',
    ],
    ['a number from 1e21 up has an exponent', 'css({ width: `${1e21}px` })', { width: '1e+21px' }, 'width: 1e+21px'],
    ['a bitwise operator wraps to 32 bits', 'css({ zIndex: (2 ** 32) | 1 })', { zIndex: 1 }, 'z-index: 1'],
    // Two strings compare by code unit, not as numbers.
    ['two strings compare as strings', "css({ zIndex: '10' < '9' ? 1 : 2 })", { zIndex: 1 }, 'z-index: 1'],
    ['`length` is in an array', "css({ zIndex: 'length' in [1] ? 1 : 2 })", { zIndex: 1 }, 'z-index: 1'],
    ['a `null` element is in an array', 'css({ zIndex: 0 in [null, 2] ? 1 : 2 })', { zIndex: 1 }, 'z-index: 1'],
    ['a missing property is not in an object', "css({ zIndex: 'a' in {} ? 1 : 2 })", { zIndex: 2 }, 'z-index: 2'],
    [
      'a property written as `undefined` is in an object',
      "css({ zIndex: 'a' in { a: undefined } ? 1 : 2 })",
      { zIndex: 1 },
      'z-index: 1',
    ],
    // JavaScript trims U+FEFF from a string it converts, and not U+0085, below.
    ['a string trimmed as JavaScript trims it', "css({ zIndex: '\\ufeff5' * 2 })", { zIndex: 10 }, 'z-index: 10'],
  ])('%s', (_, body, data, declaration) => {
    const result = extract(body)

    expect(result.json).toMatchObject([{ name: 'css', data: [data] }])
    expect(result.css).toContain(declaration)
  })

  test.each([
    ['`+`', `const z = [, 2]\ncss({ zIndex: z[0] + 1 })`],
    ['`-`', `const z = [, 2]\ncss({ zIndex: z[0] - 1 })`],
    ['a template literal', 'const z = [, 2]\ncss({ zIndex: `${z[0]}` })'],
    ['a destructuring default', 'const [z = 1] = [, 2]\ncss({ zIndex: z })'],
  ])('%s on an array hole is not guessed', (_, body) => {
    // A hole is `undefined`, and `undefined + 1` is `NaN`: nothing a rule should be written for.
    expect(extract(body).css).not.toContain('z-index')
  })

  // Each is true or false at runtime, and not what the build would have said: both are written.
  test.each([
    ['`in` for what the prototype has', "css({ zIndex: 'toString' in {} ? 1 : 2 })"],
    ['`in` for an array method', "css({ zIndex: 'map' in [1] ? 1 : 2 })"],
    ['`in` for a hole', 'css({ zIndex: 0 in [, 2] ? 1 : 2 })'],
    ['`in` after a spread the build cannot read', "css({ zIndex: 'a' in { ...unknown() } ? 1 : 2 })"],
    // Whitespace in a string literal is collapsed as it is read, and a tab orders before a space.
    ['strings holding whitespace compared', "css({ zIndex: 'a\\tb' < 'a b' ? 1 : 2 })"],
  ])('%s is left undecided', (_, body) => {
    const { css } = extract(body)

    expect(css).toContain('z-index: 1')
    expect(css).toContain('z-index: 2')
  })

  // Only a hole read as `null` leaves it unknown whether the default stands in; a partly known
  // object is surely not `undefined`, and what is known of it stays known.
  test('a destructuring default keeps what is known of a partly known value', () => {
    const { css } = extract("const { theme = {} } = { theme: { w: '2', h: compute() } }\ncss({ width: theme.w })")

    expect(css).toContain('width: var(--sizes-2)')
  })

  test('a string JavaScript reads as `NaN` is not read as a number', () => {
    // U+0085 is whitespace to Rust's `trim` and not to JavaScript, so `'\u00855' * 2` is `NaN`.
    expect(extract("css({ zIndex: '\\u00855' * 2 })").css).not.toContain('z-index')
  })
})
