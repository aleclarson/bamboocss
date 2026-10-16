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

  // A property the object holds shadows what its prototype has, and `null` sets none to inherit.
  test.each([
    ['beside a prototype the build cannot evaluate', 'const o = { zIndex: 1, __proto__: base() }'],
    ['beside a `null` prototype', 'const o = { zIndex: 1, __proto__: null }'],
  ])('%s', (_, definition) => {
    const body = `${definition}\nexport const A = css({ zIndex: o.zIndex })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_1'], skipped: [] })
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

/**
 * An element read by index. A hole and an `undefined` element are held as `null`, as a `null` one
 * is, so a read of one is known to be nullish without being known to be either: enough to decide
 * `??`, `||` and a test, where the two agree, and not to convert, where `null` is 0 and `"null"`
 * and `undefined` is `NaN` and `"undefined"` — below.
 */
describe('an array element', () => {
  test.each([
    ['a hole decides `??`', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] ?? 1 })', 'z_1'],
    ['a hole decides `||`', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] || 1 })', 'z_1'],
    ['a hole decides a test', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] ? 1 : 2 })', 'z_2'],
    [
      'a hole in a nested array',
      'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[0] ?? 3 })',
      'z_3',
    ],
    [
      'a `null` element',
      "const t = ['red.300', null]\nexport const A = css({ color: t[1] ?? 'blue.300' })",
      'c_blue.300',
    ],
    [
      'a `null` element written out',
      'const z = [null, 2]\nexport const A = css({ gridArea: `${z[0]}x` })',
      'grid-area_nullx',
    ],
    ['an element beside a hole', 'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[1] })', 'z_2'],
    [
      'an element a rest takes beside a hole',
      'const [, ...r] = [1, , 3]\nexport const A = css({ zIndex: r[1] })',
      'z_3',
    ],
    ['holes joined', "const a = [1, , 2]\nexport const A = css({ gridArea: a.join('-') })", 'grid-area_1--2'],
    ['the length of an array with a hole', 'const a = [, 2]\nexport const A = css({ zIndex: a.length })', 'z_2'],
    ['a string by index', "export const A = css({ gridArea: 'abc'[1] })", 'grid-area_b'],
    ['a string past its end', "export const A = css({ gridArea: 'abc'[5] ?? 'z' })", 'grid-area_z'],
    [
      'a hole read in a helper',
      'const z = [, 2]\nconst f = () => z[0] ?? 4\nexport const A = css({ zIndex: f() })',
      'z_4',
    ],
    [
      'a hole through `Object.assign`',
      'const t = Object.assign({}, { s: [, 2] })\nexport const A = css({ zIndex: t.s[0] ?? 7 })',
      'z_7',
    ],
    [
      'an element beside one the build cannot evaluate',
      'const a = [compute(), 2]\nconst f = () => a[1]\nexport const A = css({ zIndex: f() })',
      'z_2',
    ],
    // A spread of unknown length moves what comes after it, not what came before.
    [
      'an element before a spread of unknown length',
      "const a = ['a', ...unknown()]\nconst f = () => a[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    [
      'elements around one the build cannot evaluate, spread',
      "const inc = [compute(), 'x']\nconst a = ['a', ...inc]\nconst f = () => a[0] + a[2]\nexport const A = css({ gridArea: f() })",
      'grid-area_ax',
    ],
    [
      'a source of `Object.assign` after an unknown one',
      "const t = Object.assign({}, maybe(), { a: 'x' })\nconst f = () => t.a\nexport const A = css({ gridArea: f() })",
      'grid-area_x',
    ],
    [
      'a string by index before a space',
      "const f = () => 'a b'[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    // An array opened by a spread of unknown length still says where its elements before it are.
    [
      'an element before a spread of unknown length, spread again',
      "const f = () => [...['a', ...unknown()]][0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    [
      'an element a rest takes from before a spread of unknown length',
      "const [x, ...r] = ['a', 'b', ...unknown()]\nconst f = () => r[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_b',
    ],
    // `css()` drops a `null` and an `undefined` alike, so a hole is as exact as either there.
    [
      'a hole as a css() value',
      'const z = [, 2]\nconst f = () => z[0]\nexport const A = css({ zIndex: 1, color: f() })',
      'z_1',
    ],
    ['a hole as the whole css() value', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] })', ''],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })
})

/**
 * A property written as `undefined` replaces what was there, as at runtime: the value leaves the
 * key out, and it used to keep whatever an earlier property, spread or source put there, so
 * `{ ...defaults, size: undefined }` kept the default.
 */
describe('a property written as `undefined`', () => {
  test.each([
    ['by `Object.assign`', "const t = Object.assign({}, { a: 'x' }, { a: undefined })"],
    ['by a spread', "const t = { a: 'x', ...{ a: undefined } }"],
    ['by a later property', "const t = { a: 'x', a: undefined }"],
    ['over a default spread before it', "const defaults = { a: 'x' }\nconst t = { ...defaults, a: undefined }"],
    [
      'through a spread of a spread',
      "const inner = { a: undefined }\nconst mid = { ...inner }\nconst t = { a: 'x', ...mid }",
    ],
  ])('%s', (_, definition) => {
    const body = `${definition}\nconst f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['grid-area_q'], skipped: [] })
  })

  // A spread whose record says which of its keys it did not know leaves the others known.
  test('a key beside one a spread could not evaluate', () => {
    const body =
      'const o = { x: 1, ...{ a: f(), b: 1 } }\nconst g = () => o.b + o.x\nexport const A = css({ zIndex: g() })'

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_2'], skipped: [] })
  })

  // What was not known was under the key the pattern took: the rest is known.
  test('a rest of what was known', () => {
    const body =
      'const { a, ...rest } = { a: f(), b: 1 }\nconst g = () => rest.b\nexport const A = css({ zIndex: g() })'

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  // The rest is without the keys the pattern took, and says nothing of them.
  test('not the key a rest pattern took out', () => {
    const body =
      "const { a, ...rest } = { a: undefined, b: 'x' }\nconst t = { a: 'md', ...rest }\n" +
      "const f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })"

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['grid-area_md'], skipped: [] })
  })

  // In the order JavaScript keeps the keys: the first written, wherever a later one removed one.
  test('keeping the order of the keys left', () => {
    const body = "export const A = css({ ...{ color: 'red.300', margin: '2', padding: '4' }, color: undefined })"

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['m_2 p_4'], skipped: [] })
  })
})

// A recipe takes a `null` variant for an explicit miss and `undefined` for its default, so a hole
// is never compiled as the one or the other: the selection is made where it runs.
test('a hole selecting a recipe variant selects at runtime', () => {
  const result = createFoldFixture().fold(
    `import { buttonStyle } from 'styled-system/recipes'\nconst sizes = ['sm', , 'lg']\nexport const A = buttonStyle({ size: sizes[1] })\n`,
  )

  expect(result.skipped).toEqual([])
  expect(result.code).toContain('cvaMap([sizes[1]]')
})

/**
 * `in` decides a helper's choice, which the audit leaves to the evaluator, where the key is surely
 * there or surely not, and nowhere else.
 */
describe('which keys an object has', () => {
  const choice = (test: string, definition: string) =>
    withImport(
      `const c = Math.random() > 0.5\n${definition}\nconst g = () => (${test} ? 1 : 2)\nexport const A = css({ zIndex: g() })`,
    )

  test.each([
    ['a key written with one of two values', "'a' in o", "const o = { a: c ? 'x' : 'y' }", 'z_1'],
    ['such a key after a spread the build cannot read', "'a' in o", 'const o = { ...x(), a: c ? 1 : 2 }', 'z_1'],
    ['such a key in a nested object', "'x' in o.a", 'const o = { a: { x: c ? 1 : 2 } }', 'z_1'],
    ['a key held before a spread the build cannot read', "'a' in o", 'const o = { a: 1, ...x() }', 'z_1'],
    ['a key not held, with a `null` prototype', "'dark' in o", 'const o = { __proto__: null, zIndex: 1 }', 'z_2'],
    ['a key not held, with a number for a prototype', "'dark' in o", 'const o = { __proto__: 5, zIndex: 1 }', 'z_2'],
  ])('%s', (_, test, definition, className) => {
    expect(foldOf(choice(test, definition))).toMatchObject({ classes: [className], skipped: [] })
  })

  test.each([
    ['a key a branch of a spread may hold', "'a' in o", 'const o = { ...(c ? { a: 1 } : {}) }'],
    ['a key the prototype may hold', "'dark' in o", 'const o = { zIndex: 1, __proto__: base() }'],
    // `track()` may have written to `s`, and the build could not follow it.
    ['a key in a spread of a value code ran before', "'z' in { ...(track(), s) }", 'const s = { a: 1, b: f() }'],
    ['a key `Object.assign` takes from one', "'z' in Object.assign({}, (track(), s))", 'const s = { a: 1, b: f() }'],
  ])('not %s', (_, test, definition) => {
    expect(foldOf(choice(test, definition))).toMatchObject({ classes: [], skipped: ['dynamic'] })
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
    [
      'a hole in a nested array converted',
      'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[0] - 1 })',
    ],
    ['a hole spread into an array', 'const z = [...[, 2]]\nexport const A = css({ zIndex: z[0] - 1 })'],
    ['a hole a rest element takes', 'const [, ...r] = [1, , 3]\nexport const A = css({ zIndex: r[0] - 1 })'],
    // A default stands in for `undefined`, and a hole read as `null` does not say it is one.
    ['a destructuring default on a hole', 'const [a = 1] = [, 2]\nexport const A = css({ zIndex: a ?? 3 })'],
    [
      'an element after a spread the build cannot evaluate',
      'const a = [...compute(), 2]\nexport const A = css({ zIndex: a[1] ?? 5 })',
    ],
    ['an element written later', 'const a = [1, 2]\na[0] = 5\nexport const A = css({ zIndex: a[0] ?? 1 })'],
    // An element the build cannot evaluate is held as `null` in its place, and decides nothing.
    [
      'an unknown element in a helper',
      "const z = [compute()]\nconst f = () => z[0] ?? 'red.300'\nexport const A = css({ color: f() })",
    ],
    [
      'an unknown element deciding a test',
      "const z = [compute()]\nexport const A = css({ content: 'a' + (z[0] ? 'b' : 'c') })",
    ],
    [
      'an element after a spread of unknown length',
      "const w = [...unknown(), 1]\nconst z = [...w, 'x']\nconst f = () => z[1]\nexport const A = css({ gridArea: f() })",
    ],
    // A hole wherever it is kept converts as neither `null` nor `undefined`.
    [
      'a hole passed for a parameter with a default',
      'const z = [, 2]\nconst f = (a = 1) => a ?? 2\nexport const A = css({ zIndex: f(z[0]) })',
    ],
    [
      'a hole through a rest parameter',
      'const f = (...a) => a[0] - 1\nconst z = [, 2]\nexport const A = css({ zIndex: f(z[0]) })',
    ],
    [
      'a hole kept in an object',
      'const z = [, 2]\nconst o = { a: z[0] }\nconst f = () => o.a - 1\nexport const A = css({ zIndex: f() })',
    ],
    [
      'a hole kept in an array',
      'const z = [, 2]\nconst y = [z[0]]\nconst f = () => y[0] - 1\nexport const A = css({ zIndex: f() })',
    ],
    [
      'a hole through `Object.assign` converted',
      'const t = Object.assign({}, { s: [, 2] })\nconst f = () => t.s[0] + 1\nexport const A = css({ zIndex: f() })',
    ],
    ['a hole as a computed key', "const f = () => ({ [[, 1][0]]: 'red.300' })\nexport const A = css(f())"],
    [
      'a hole as the separator of `join`',
      'const z = [, 2]\nconst f = () => [1, 2].join(z[0])\nexport const A = css({ gridArea: f() })',
    ],
    ['a property of a hole', 'const z = [, 2]\nconst f = () => z[0].x\nexport const A = css({ zIndex: f() })'],
    // A literal's whitespace is collapsed as it is read, so past a space an index is not known.
    ['a string index past a space', "const f = () => 'a  b'[2]\nexport const A = css({ gridArea: f() })"],
    ['the length of a string holding a space', "const f = () => 'a  b'.length\nexport const A = css({ zIndex: f() })"],
    // An array whose length is not known, kept in an object: nothing after it is where it is held.
    [
      'an element after an array of unknown length, through Object.assign',
      "const g = Object.assign({}, { l: ['a', ...unknown()] })\nconst a = [...g.l, 'z']\nconst f = () => a[1]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element after an array of unknown length, from an object a spread opened',
      "const g = { l: ['a', ...unknown()], ...maybe() }\nconst a = [...g.l, 'z']\nconst f = () => a[1]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element past what an open array said',
      "const f = () => [...['a', ...unknown()]][1] ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    // A style object is walked with `for…in`, which reads what it inherits from its prototype.
    [
      'an object with a prototype',
      "const base = { color: 'red.300' }\nexport const A = css({ __proto__: base, bg: 'blue.300' })",
    ],
    // `css()` drops an argument whose values are all `undefined`, and keeps one holding `null`,
    // which overrides what came before: with more arguments than one, a hole is either.
    [
      'a hole among the arguments of css()',
      "const z = [, 2]\nexport const A = css({ color: 'red.300' }, { color: z[0] })",
    ],
    // `Object.assign` keeps a source's undecided values, as a spread does.
    [
      'a property `Object.assign` takes as one of two values',
      "const t = Object.assign({}, { a: c ? 'x' : 'y' })\nconst f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element after a spread of unknown length',
      "const a = ['a', ...unknown(), 'b']\nconst f = () => a[2]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element the build cannot evaluate, spread',
      "const inc = [compute(), 'x']\nconst a = ['a', ...inc]\nconst f = () => a[1] ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    [
      'a property `Object.assign` takes before an unknown source',
      "const t = Object.assign({}, { a: 'x' }, maybe())\nconst f = () => t.a\nexport const A = css({ gridArea: f() })",
    ],
    // What an object said of a property before a spread that may have written over it is gone.
    [
      'a hole a later spread may have replaced',
      'const o = { a: [, 2][0], ...unknown() }\nconst p = { b: o.a }\nconst f = () => p.b - 1\nexport const A = css({ zIndex: f() })',
    ],
    // A missing property is `undefined` unless the prototype has it.
    ['a property every object has', 'const o = {}\nexport const A = css({ zIndex: o.toString ? 1 : 2 })'],
    ['an array method', 'const s = [1, 2]\nexport const A = css({ zIndex: s.includes ? 1 : 2 })'],
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
    // What runs before a comma may have written to the value after it, and the build could not
    // follow it.
    [
      'a property of a value code ran before',
      'const s = { zIndex: 1, b: f() }\nconst g = () => (track(), s).zIndex\nexport const A = css({ zIndex: g() })',
    ],
    [
      'a rest pattern’s object taken from one',
      'const { b, ...rest } = (track(), { zIndex: 1, b: f() })\nconst g = () => rest\nexport const A = css(g())',
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // The object a rest pattern makes is without the key it took, and the reason that key was not
  // known goes with it: a call refused for what it still holds is not said to be for that.
  test('for a key a rest pattern did not take', () => {
    const make = 'const make = () => { compute()\nreturn 1 }\nconst o = { zIndex: 1, b: make() }\n'
    const refusalOf = (body: string) => createFoldFixture().fold(withImport(make + body)).skipped[0]?.refusal

    expect(refusalOf('export const A = css({ ...o, color: other() })')).toMatchObject({ helper: 'make' })
    expect(refusalOf('const { b, ...rest } = o\nexport const A = css({ ...rest, color: other() })')).toBeUndefined()
  })
})
