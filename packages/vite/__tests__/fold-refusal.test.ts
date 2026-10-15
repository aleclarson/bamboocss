import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Why the compiler refused a call.
 *
 * The evaluator does not run what it would have to guess at — a statement in a helper's body,
 * a binding written after its declaration — and the strict compiler then reports the call as
 * `dynamic`. Where the call is says nothing about why: the statement is in the helper, which
 * may be in another file, and the write may be anywhere in the module. Each refusal carries
 * what it was and where it is.
 */
const withImport = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

const refusalOf = (code: string, filePath?: string, files?: Record<string, string>) => {
  const fixture = createFoldFixture()
  if (files) fixture.addFiles(files)
  const result = fixture.fold(code, filePath)

  expect(result.folded).toHaveLength(0)
  expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  return result.skipped[0]!.refusal
}

describe('a refused call says why', () => {
  test("a statement in a helper's body, with the helper and where it is", () => {
    const refusal = refusalOf(
      withImport(
        `const tone = (t) => {\n  switch (t) { case 'a': return { color: 'red.300' } }\n  return {}\n}\nexport const A = css(tone('a'))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'switch', helper: 'tone', line: 3, column: 3 })
    expect(refusal?.filePath).toMatch(/app\/src\/test\.tsx$/)
  })

  test('a statement run for its effect, shown as written', () => {
    const refusal = refusalOf(
      withImport(
        `const make = (primary) => {\n  const styles = { paddingX: '4' }\n  if (primary) styles.color = 'red.300'\n  return styles\n}\nexport const A = css(make(true))`,
      ),
    )

    expect(refusal).toMatchObject({
      kind: 'statement',
      subject: 'expression',
      helper: 'make',
      excerpt: "styles.color = 'red.300'",
      line: 4,
    })
  })

  test('a `throw` the call reaches', () => {
    const refusal = refusalOf(
      withImport(
        `const tone = (t) => {\n  if (!t) throw new Error('tone')\n  return { color: t }\n}\nexport const A = css(tone(''))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'throw', helper: 'tone', line: 3 })
  })

  test('a binding written into after its declaration, with the write', () => {
    const refusal = refusalOf(
      withImport(`const base = { color: 'red.300' }\nbase.color = 'blue.300'\nexport const A = css(base)`),
    )

    expect(refusal).toMatchObject({
      kind: 'write',
      subject: 'base',
      excerpt: "base.color = 'blue.300'",
      line: 3,
      column: 1,
    })
  })

  test('a reassigned binding', () => {
    const refusal = refusalOf(
      withImport(`let tone = 'red.300'\ntone = 'blue.300'\nexport const A = css({ color: tone })`),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'tone', excerpt: "tone = 'blue.300'", line: 3 })
  })

  test('an array written into, then joined', () => {
    const refusal = refusalOf(
      withImport(`const parts = ['red', '300']\nparts.push('x')\nexport const A = css({ color: parts.join('.') })`),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'parts', excerpt: "parts.push('x')", line: 3, column: 1 })
  })

  test("a written binding a helper's `if` tests", () => {
    const refusal = refusalOf(
      withImport(
        `let primary = true\nprimary = false\nconst tone = () => {\n  if (primary) return { color: 'red.300' }\n  return {}\n}\nexport const A = css(tone())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'primary', excerpt: 'primary = false', line: 3 })
  })

  test("an `enum` in a helper's body", () => {
    const refusal = refusalOf(
      withImport(
        `const tone = () => {\n  enum Tone { Red = 'red.300' }\n  return { color: Tone.Red }\n}\nexport const A = css(tone())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'enum', helper: 'tone', line: 3 })
  })

  test('a reassigned helper', () => {
    const refusal = refusalOf(
      withImport(
        `let make = () => ({ color: 'red.300' })\nmake = () => ({ color: 'blue.300' })\nexport const A = css(make())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'make', line: 3 })
  })

  test('a helper in another module names that module', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { tone } from './theme'\nexport const A = css(tone('red.300'))\n`,
      'app/use.tsx',
      {
        'app/theme.ts': `export const tone = (t) => {\n  for (const key of ['color']) {}\n  return { color: t }\n}\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'for…of', helper: 'tone', line: 2 })
    expect(refusal?.filePath).toMatch(/app\/theme\.ts$/)
  })

  test('a call that is dynamic for any other reason carries none', () => {
    const result = createFoldFixture().fold(withImport(`export const f = (t) => css({ color: t })`))

    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
    expect(result.skipped[0]!.refusal).toBeUndefined()
  })
})

/**
 * A recursion the evaluator cannot see the end of.
 *
 * On a value the build cannot read — `nest(props.depth)` — a recursive helper never reaches its
 * base case. Following it overflowed the native stack: the process died, dev server and all, with
 * no message. It is refused now, like any other code the evaluator will not run.
 */
describe('a recursion with no end the build can see', () => {
  test('on a value the build cannot read, at once, naming the helper', () => {
    // `d - 1` is as unknown as `d`, so the next call is the one already running over again.
    const refusal = refusalOf(
      withImport(
        `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1), color: 'red.300' } : {})\n` +
          `export const f = (props) => css(nest(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest', line: 2, column: 14 })
  })

  test('branching, as surely', () => {
    const refusal = refusalOf(
      withImport(
        `const tree = (d) => (d > 0 ? { '& > a': tree(d - 1), '& > b': tree(d - 1) } : {})\n` +
          `export const f = (props) => css(tree(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'tree' })
  })

  test('on arguments that never change, known or not', () => {
    const refusal = refusalOf(withImport(`const again = (d) => ({ color: again(d) })\nexport const A = css(again(1))`))

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'again' })
  })

  test('through a second helper', () => {
    const refusal = refusalOf(
      withImport(
        `const a = (d) => ({ '& > div': b(d - 1) })\nconst b = (d) => a(d)\n` +
          `export const f = (props) => css(a(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'a' })
  })

  test('through another module', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { nest } from './nest'\nexport const f = (props) => css(nest(props.depth))\n`,
      'app/use.tsx',
      { 'app/nest.ts': `export const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\n` },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest' })
    expect(refusal?.filePath).toMatch(/app\/nest\.ts$/)
  })

  test('between modules, at the helper called again', () => {
    // Each call into another module parses it afresh, so the call running is not one to compare
    // against: the second call into `a` is refused, whatever its arguments.
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { a } from './a'\nexport const f = (props) => css(a(props.depth))\n`,
      'app/use.tsx',
      {
        'app/a.ts': `import { b } from './b'\nexport const a = (d) => ({ '& > div': b(d - 1) })\n`,
        'app/b.ts': `import { a } from './a'\nexport const b = (d) => a(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'module', helper: 'a', line: 2, column: 18 })
    expect(refusal?.filePath).toMatch(/app\/a\.ts$/)
  })

  test('between modules, at the function however its export is written', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { a } from './a'\nexport const f = (props) => css(a(props.depth))\n`,
      'app/use.tsx',
      {
        'app/a.ts': `import { b } from './b'\nconst a = (d) => ({ '& > div': b(d - 1) })\nexport { a }\n`,
        'app/b.ts': `import { a } from './a'\nexport const b = (d) => a(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'module', helper: 'a', line: 2, column: 11 })
  })

  test('on arguments that change without ending, cut off at the depth', () => {
    const refusal = refusalOf(
      withImport(`const deeper = (d) => ({ '& > div': deeper(d + 1) })\nexport const A = css(deeper(0))`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'deeper' })
  })

  test('one that would end, deeper than the depth, as surely', () => {
    const refusal = refusalOf(
      withImport(
        `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const A = css(nest(70))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'nest' })
  })

  test('named for the recursion, not the helper it reached at the depth', () => {
    // The call past the depth is `leaf`, which recurses into nothing.
    const refusal = refusalOf(
      withImport(
        `const leaf = () => ({ color: 'red.300' })\n` +
          `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1), color: 'blue.500' } : leaf())\n` +
          `export const A = css(walk(63))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk', line: 3, column: 14 })
  })

  test('named for the recursion when the helper it reached is in another module', () => {
    // `leaf`'s module has none of `walk`'s calls to name it by; `walk`'s, returned to, does.
    const refusal = refusalOf(
      withImport(
        `import { leaf } from '../leaf'\n` +
          `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1) } : leaf())\n` +
          `export const A = css(walk(63))`,
      ),
      undefined,
      { 'app/leaf.ts': `export const leaf = () => ({ color: 'red.300' })\n` },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk', line: 3, column: 14 })
    expect(refusal?.filePath).toMatch(/app\/src\/test\.tsx$/)
  })

  test('leaves no export it gave up on in the cache', () => {
    // After the refusal, `theme` is read while the abandoned call unwinds, and `makeTheme()` is
    // refused with it. Asked for again elsewhere, `theme` is evaluated afresh.
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/theme.ts': `const makeTheme = () => ({ tone: 'red.300' })\nexport const theme = makeTheme()\n`,
    })
    const walked = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { theme } from '../theme'\n` +
        `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1), color: theme.tone } : {})\n` +
        `export const A = css(walk(70))\n`,
      'app/src/walk.tsx',
    )
    const plain = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { theme } from '../theme'\nexport const B = css({ color: theme.tone })\n`,
      'app/src/plain.tsx',
    )

    expect(walked.skipped[0]?.refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk' })
    expect(plain.skipped).toEqual([])
    expect(plain.folded).toHaveLength(1)
  })

  test('through a function written in place, named for the helper it is written in', () => {
    const refusal = refusalOf(
      withImport(`const outer = (n) => (() => ({ '& > div': outer(n + 1) }))()\nexport const A = css(outer(0))`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'outer', line: 2, column: 15 })
  })

  test('branching on arguments that change, cut off at the depth without following every branch there', () => {
    // Every call has a key of its own, so none repeats; the first branch reaches the depth and
    // nothing more is followed. Down every branch, this was 2^64 calls.
    const refusal = refusalOf(
      withImport(
        `const tree = (d, p) => (d > 0 ? { [p + 'a']: tree(d - 1, p + 'a'), [p + 'b']: tree(d - 1, p + 'b') } : {})\n` +
          `export const f = (props) => css(tree(props.depth, '&'))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'tree' })
  })

  /**
   * Exported values are cached across calls, so where one was first asked for must not decide
   * what it is. Asked for 30 calls deep, `deep` has 34 levels left for its 40 and is refused;
   * asked for directly, it has all of them — and the same holds whichever comes first.
   */
  describe('cut off by where it was asked for, whatever was asked first', () => {
    const source = `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const deep = nest(40)\n`
    const walk = (fixture: ReturnType<typeof createFoldFixture>) =>
      fixture.fold(
        `import { css } from 'styled-system/css'\nimport { deep } from '../deep'\n` +
          `const walk = (n) => (n > 0 ? walk(n - 1) : deep)\nexport const A = css(walk(30))\n`,
        'app/src/walk.tsx',
      )
    const direct = (fixture: ReturnType<typeof createFoldFixture>) =>
      fixture.fold(
        `import { css } from 'styled-system/css'\nimport { deep } from '../deep'\nexport const B = css(deep)\n`,
        'app/src/direct.tsx',
      )

    test.each([
      ['the deep one first', true],
      ['the direct one first', false],
    ])('%s', (_, deepFirst) => {
      const fixture = createFoldFixture()
      // A byte apart, so neither order finds what the other left in the cache.
      fixture.addFiles({ 'app/deep.ts': `${source}// ${deepFirst}\n` })
      const first = deepFirst ? walk(fixture) : undefined
      const plain = direct(fixture)
      const walked = first ?? walk(fixture)

      expect(walked.skipped[0]?.refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'nest' })
      expect(plain.skipped).toEqual([])
      expect(plain.folded).toHaveLength(1)
    })
  })

  test('branching within the depth, until the calls run out', () => {
    // A depth the build can read, and an end, but `2^15` calls to get there.
    const refusal = refusalOf(
      withImport(`const fan = (d) => (d > 0 ? fan(d - 1) + fan(d - 1) : 1)\nexport const A = css({ zIndex: fan(14) })`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'calls', helper: 'fan' })
  })

  test.each([
    [
      'nested',
      `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const A = css(nest(3))`,
    ],
    [
      'branching',
      `const fan = (d) => (d > 0 ? { '& > a': fan(d - 1), '& > b': fan(d - 1) } : { color: 'red.300' })\nexport const A = css(fan(3))`,
    ],
    // `g()` has the same arguments at every level, but not the same `n`: not a call over again.
    [
      'through a closure called the same way each time',
      `const f = (n) => {\n  const g = () => (n > 0 ? { '& > div': f(n - 1) } : { color: 'red.300' })\n  return g()\n}\nexport const A = css(f(3))`,
    ],
  ])('a recursion that ends still compiles: %s', (_, body) => {
    const result = createFoldFixture().fold(withImport(body))

    expect(result.skipped).toEqual([])
    expect(result.folded).toHaveLength(1)
  })
})

describe('carrying the reason changes nothing that compiles', () => {
  // `x.join()` is tried as an array's join first. A refusal in `x` is the reason only when
  // nothing else calls it: here `helpers.join` is a method, and `size` has nothing to do with it.
  test('a method named `join`, on an object holding a value that was refused', () => {
    const result = createFoldFixture().fold(
      withImport(
        `let size = '1'\nsize = '2'\nconst helpers = { size, join: (color) => ({ color }) }\nexport const A = css(helpers.join('red.300'))`,
      ),
    )

    expect(result.skipped).toEqual([])
    expect(result.folded.map((entry) => entry.className)).toEqual(['c_red.300'])
  })
})
