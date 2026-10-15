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
  ])('%s', (_, body, data, declaration) => {
    const result = extract(body)

    expect(result.json).toMatchObject([{ name: 'css', data: [data] }])
    expect(result.css).toContain(declaration)
  })

  test('`+` on an array hole is not guessed', () => {
    // A hole is `undefined`, and `undefined + 1` is `NaN`: nothing a rule should be written for.
    const result = extract(`const z = [, 2]\ncss({ zIndex: z[0] + 1 })`)

    expect(result.css).not.toContain('z-index')
  })
})
