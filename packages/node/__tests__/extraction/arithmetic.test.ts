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
    // Which keys an object has is known though what one holds is not.
    [
      'a property whose value is not known is in an object',
      "css({ zIndex: 'a' in { a: f() } ? 1 : 2 })",
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

  // A later write of a key replaces it, the values an earlier one could not decide between too.
  test('a key written again leaves no rule for the values it replaced', () => {
    const { css } = extract(
      "const cond = Math.random() > 0.5\ncss({ color: cond ? 'red.300' : 'blue.300', color: 'green.300' })",
    )

    expect(css).toContain('--colors-green-300')
    expect(css).not.toContain('--colors-red-300')
    expect(css).not.toContain('--colors-blue-300')
  })

  // A key written by a spread with a value it could not decide between, or could not evaluate,
  // keeps nothing of what was there: both arms of a choice on it are written.
  test.each([
    ['one of two values, by a spread', "const o = { a: 'p', ...{ a: c ? '' : 'y' } }"],
    ['one of two values, by `Object.assign`', "const o = Object.assign({ a: 'p' }, { a: c ? '' : 'y' })"],
    ['a value not known, by a spread', "const o = { a: 'p', ...{ a: f(), b: 1 } }"],
  ])('a key written as %s is undecided', (_, definition) => {
    const { css } = extract(`${definition}\ncss({ color: o.a ? 'red.300' : 'blue.300' })`)

    expect(css).toContain('--colors-red-300')
    expect(css).toContain('--colors-blue-300')
  })

  test.each([
    // A key under a value the object could not decide between is held as a branch of a spread it
    // could not choose is, which may have it or not: neither arm is taken for sure.
    [
      'a key with one of two values is in an object',
      "const o = { a: c ? 'x' : 'y' }\ncss({ color: 'a' in o ? 'red.300' : 'blue.300' })",
      false,
    ],
    [
      'a key in one branch of a spread',
      "const o = { ...(c ? { a: 1 } : {}) }\ncss({ color: 'a' in o ? 'red.300' : 'blue.300' })",
      false,
    ],
    // `__proto__: base` sets the prototype, whose keys the object inherits.
    [
      'a key may be inherited from an unknown prototype',
      "const o = { __proto__: theme }\ncss({ color: 'dark' in o ? 'red.300' : 'blue.300' })",
      false,
    ],
    // A rest pattern that took a key the build cannot name may have taken any.
    [
      'a rest pattern took a key not known',
      "const { [k]: _, ...rest } = { a: '1', b: '2' }\ncss({ color: 'a' in rest ? 'red.300' : 'blue.300' })",
      false,
    ],
  ])('%s', (_, body, decided) => {
    const { css } = extract(body)

    expect(css).toContain('--colors-red-300')
    expect(css.includes('--colors-blue-300')).toBe(!decided)
  })

  // A later write of a key replaces it in every branch of a spread the build could not choose,
  // and a spread's key it could not evaluate replaces what was undecided under it.
  test.each([
    ['in each branch of a spread', "const o = { ...(c ? { a: 'x', b: 'y' } : {}), a: 'z' }"],
    ['by a spread of a value not known', "const o = { a: c ? 'x' : 'y', ...{ a: f(), b: 1 } }"],
  ])('a key written over %s leaves no rule for what it replaced', (_, definition) => {
    const { css } = extract(`${definition}\ncss({ display: o.a })`)

    expect(css).not.toContain('display: x')
    expect(css).not.toContain('display: y')
  })

  test('a string JavaScript reads as `NaN` is not read as a number', () => {
    // U+0085 is whitespace to Rust's `trim` and not to JavaScript, so `'\u00855' * 2` is `NaN`.
    expect(extract("css({ zIndex: '\\u00855' * 2 })").css).not.toContain('z-index')
  })
})
