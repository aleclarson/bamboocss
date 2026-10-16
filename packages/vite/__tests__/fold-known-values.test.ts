import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Values the build knows, which it used to fail the compile on as `dynamic`.
 *
 * Two shapes are everywhere in helper code. A default for an option the caller did not pass —
 * `o.display ?? 'block'` — reads a property that is not there, and `undefined` is as decided as
 * any value: falsy and nullish. And a property of a theme object is known whatever the object's
 * other properties are: `theme.radius` beside `shadow: computeShadow()`. Both failed the build
 * with nothing to say why.
 */
const withImport = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

const foldOf = (code: string, files?: Record<string, string>) => {
  const fixture = createFoldFixture()
  if (files) fixture.addFiles(files)
  const result = fixture.fold(code)
  return {
    classes: result.folded.map((entry) => entry.className),
    skipped: result.skipped.map((entry) => entry.reason),
    css: fixture.getCss(),
  }
}

describe('a default for a value that is not there', () => {
  test.each([
    [
      '`??` on an option not passed',
      `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box())`,
    ],
    [
      '`||` on an option not passed',
      `const box = (o = {}) => ({ display: o.display || 'block' })\nexport const A = css(box())`,
    ],
    [
      '`??` on an argument not passed',
      `const box = (display) => ({ display: display ?? 'block' })\nexport const A = css(box())`,
    ],
    ['`??` on a property not there', `const opts = {}\nexport const A = css({ display: opts.display ?? 'block' })`],
    ['`??` on `undefined` itself', `export const A = css({ display: undefined ?? 'block' })`],
    [
      '`&&` short-circuiting on `undefined`',
      `const box = (o = {}) => ({ display: (o.hidden && 'none') ?? 'block' })\nexport const A = css(box())`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_block'], skipped: [] })
  })

  test('a choice on an option not passed takes the other arm', () => {
    const body = `const box = (o = {}) => ({ padding: o.dense ? '2' : '4' })\nexport const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an `if` on an option not passed takes the other branch', () => {
    const body =
      `const box = (o = {}) => {\n  if (o.dense) return { padding: '2' }\n  return { padding: '4' }\n}\n` +
      `export const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an option passed still wins', () => {
    const body = `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box({ display: 'flex' }))`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_flex'], skipped: [] })
  })
})

describe('one property of an object, whatever its siblings are', () => {
  test('beside a property the build cannot evaluate', () => {
    const body = `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('beside a property chosen at runtime, without that property’s rules', () => {
    const body =
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4', w: '10' }\n` +
      `export const A = css({ width: theme.w })`
    const { classes, skipped, css } = foldOf(withImport(body))

    expect({ classes, skipped }).toEqual({ classes: ['w_10'], skipped: [] })
    expect(css).not.toContain('.px_')
  })

  test('nested', () => {
    const body = `const theme = { sizes: { w: '10', h: compute() } }\nexport const A = css({ width: theme.sizes.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('read by a helper', () => {
    const body = `const theme = { px: compute(), w: '10' }\nconst size = () => ({ width: theme.w })\nexport const A = css(size())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('imported from another module', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), sizes: { w: '10', h: compute() } }\n` }
    const code = withImport(`import { theme } from './theme'\nexport const A = css({ width: theme.sizes.w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test.each([
    [
      'destructured',
      `const theme = { px: compute(), w: '10' }\nconst { w } = theme\nexport const A = css({ width: w })`,
    ],
    [
      'destructured, nested and renamed',
      `const theme = { px: compute(), sizes: { w: '10' } }\nconst { sizes: { w: width } } = theme\nexport const A = css({ width })`,
    ],
    [
      'read with a literal key',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme['w'] })`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('destructured from an import', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), w: '10' }\n` }
    const code = withImport(`import { theme } from './theme'\nconst { w } = theme\nexport const A = css({ width: w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('after a spread the build cannot evaluate, which it overrides', () => {
    const body = `const theme = { ...other(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })
})

/**
 * `+` evaluates the way the source does at runtime. It used to concatenate whatever the operands
 * were, so `base + 1` compiled to `z_101` — a class and a rule that agreed with each other and
 * with nothing the author wrote.
 */
describe('arithmetic', () => {
  test.each([
    ['numbers add', `const base = 10\nexport const A = css({ zIndex: base + 1 })`, 'z_11', 'z-index: 11;'],
    ['inside a template literal', 'export const A = css({ width: `${2 + 3}px` })', 'w_5px', 'width: 5px;'],
    ['in a helper', `const layer = (n) => ({ zIndex: n + 1 })\nexport const A = css(layer(1))`, 'z_2', 'z-index: 2;'],
    [
      'a string operand concatenates',
      `const unit = 'px'\nexport const A = css({ width: 4 + unit })`,
      'w_4px',
      'width: 4px;',
    ],
    [
      'a numeric string concatenates too',
      `const base = '10'\nexport const A = css({ zIndex: base + 1 })`,
      'z_101',
      'z-index: 101;',
    ],
    // Written as `String(number)` writes it, which uses an exponent from 1e21 and below 1e-6.
    ['a sum from 1e21 up', 'export const A = css({ width: `${5e20 + 5e20}px` })', 'w_1e+21px', 'width: 1e+21px;'],
    ['a negative number from 1e21', 'export const A = css({ width: `${-1e21}px` })', 'w_-1e+21px', 'width: -1e+21px;'],
    [
      'an exponent with a fraction',
      'export const A = css({ width: `${1.2345e25}px` })',
      'w_1.2345e+25px',
      'width: 1.2345e+25px;',
    ],
    [
      'a fraction down to 1e-6',
      'export const A = css({ width: `${0.000001}px` })',
      'w_0.000001px',
      'width: 0.000001px;',
    ],
    ['a fraction below 1e-6', 'export const A = css({ width: `${1.5e-7}px` })', 'w_1.5e-7px', 'width: 1.5e-7px;'],
    // Past 2^53 the shortest digits are fewer than the exact ones, and the rest are zeros.
    [
      'an integer past 2^53',
      'export const A = css({ width: `${2 ** 60}px` })',
      'w_1152921504606847000px',
      'width: 1152921504606847000px;',
    ],
    [
      'a sum with no short form',
      'export const A = css({ width: `${0.1 + 0.2}px` })',
      'w_0.30000000000000004px',
      'width: 0.30000000000000004px;',
    ],
    ['negative zero', 'export const A = css({ width: `${-0 + -0}px` })', 'w_0px', 'width: 0px;'],
    [
      '`null` in a template literal',
      'export const A = css({ gridArea: `${null}x` })',
      'grid-area_nullx',
      'grid-area: nullx;',
    ],
    ['`null` plus a number', 'export const A = css({ zIndex: null + 1 })', 'z_1', 'z-index: 1;'],
    // Bitwise operators wrap to 32 bits and take a shift count modulo 32.
    ['a bitwise or past 32 bits', 'export const A = css({ zIndex: (2 ** 32) | 0 })', 'z_0', 'z-index: 0;'],
    ['a negative fraction to 32 bits', 'export const A = css({ zIndex: -1.5 | 0 })', 'z_-1', 'z-index: -1;'],
    [
      'a fraction past 2^31',
      'export const A = css({ zIndex: 2147483648.5 | 0 })',
      'z_-2147483648',
      'z-index: -2147483648;',
    ],
    ['an unsigned shift', 'export const A = css({ zIndex: -1 >>> 0 })', 'z_4294967295', 'z-index: 4294967295;'],
    ['a shift by 32', 'export const A = css({ zIndex: 1 << 32 })', 'z_1', 'z-index: 1;'],
    ['a negative shift count', 'export const A = css({ zIndex: 1 << -1 })', 'z_-2147483648', 'z-index: -2147483648;'],
    // An array index is the canonical form of an integer: `'01'` and `'+1'` are names no array has.
    ['an index written `01`', "const z = [1, 2]\nexport const A = css({ zIndex: z['01'] ?? 5 })", 'z_5', 'z-index: 5;'],
    ['an index written `+1`', "const z = [1, 2]\nexport const A = css({ zIndex: z['+1'] ?? 5 })", 'z_5', 'z-index: 5;'],
  ])('%s', (_, body, className, declaration) => {
    const result = foldOf(withImport(body))

    expect(result).toMatchObject({ classes: [className], skipped: [] })
    expect(result.css).toContain(declaration)
  })
})

describe('what is still not known', () => {
  test.each([
    [
      'the property the build cannot evaluate',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property chosen at runtime',
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property a later spread may replace',
      `const theme = { w: '10', ...other() }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a later computed key may replace',
      `const theme = { w: '10', [key()]: '12' }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a spread may define',
      `const theme = { ...other() }\nexport const A = css({ width: theme.w ?? '10' })`,
    ],
    [
      'a property read through an accessor',
      `const theme = { get w() { return '10' } }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property written later',
      `const theme = { w: '10', px: compute() }\ntheme.w = '12'\nexport const A = css({ width: theme.w })`,
    ],
    ['an option a caller passes at runtime', `export const f = (o) => css({ display: o.display ?? 'block' })`],
    [
      'a destructured property with a default standing in for it',
      `const theme = { px: compute() }\nconst { w = '10' } = theme\nexport const A = css({ width: w })`,
    ],
    // A hole reads as `undefined`, and `undefined + 1` is `NaN` — not a value to compile.
    ['`+` on an array hole', `const z = [, 2]\nexport const A = css({ zIndex: z[0] + 1 })`],
    ['`-` on an array hole', `const z = [, 2]\nexport const A = css({ zIndex: z[0] - 1 })`],
    ['`-` on an `undefined` element', `const z = [undefined, 2]\nexport const A = css({ zIndex: z[0] - 1 })`],
    ['an array hole in a template literal', 'const z = [, 2]\nexport const A = css({ gridArea: `${z[0]}x` })'],
    // Held as `null` like a hole, so a `null` element cannot be told from one either.
    ['a `null` element in a template literal', 'const z = [null, 2]\nexport const A = css({ gridArea: `${z[0]}x` })'],
    // The audit does not walk an operator's operands; the evaluator refuses these itself.
    ['`+` on a binding written later', `let base = 10\nbase = 20\nexport const A = css({ zIndex: base + 1 })`],
    ['`*` on a binding written later', `let base = 10\nbase = 20\nexport const A = css({ zIndex: base * 2 })`],
    [
      'a binding written later in a template literal',
      'let base = 10\nbase = 20\nexport const A = css({ width: `${base}px` })',
    ],
    [
      'a binding written later passed to a helper',
      `let base = 10\nbase = 20\nconst f = (n) => n\nexport const A = css({ zIndex: f(base) })`,
    ],
    [
      '`+` on a property written later',
      `const theme = { size: 10 }\ntheme.size = 20\nexport const A = css({ zIndex: theme.size + 1 })`,
    ],
    [
      '`-` on a property written later',
      `const theme = { size: 10 }\ntheme.size = 20\nexport const A = css({ zIndex: -theme.size })`,
    ],
    ['`-` on a parameter default', `export const C = (size = 10) => css({ zIndex: -size })`],
    ['`+` on a parameter default', `export const C = (size = 10) => css({ zIndex: size + 1 })`],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })
})
