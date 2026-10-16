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

  test('a string JavaScript reads as `NaN` is not read as a number', () => {
    // U+0085 is whitespace to Rust's `trim` and not to JavaScript, so `'\u00855' * 2` is `NaN`.
    expect(extract("css({ zIndex: '\\u00855' * 2 })").css).not.toContain('z-index')
  })
})
