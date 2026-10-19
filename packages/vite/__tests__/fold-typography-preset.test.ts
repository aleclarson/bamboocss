import { typographyPreset } from '../../preset-bamboo/src'
import { describe, expect, test } from 'vitest'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * The typography preset through the compiler: a `prose()` call compiles to classes the stylesheet
 * carries, under the settings a strict project builds with.
 */
const fixtureWith = (options: Parameters<typeof typographyPreset>[0] = {}, config: Record<string, unknown> = {}) =>
  createFoldFixture({ ...config, theme: { extend: typographyPreset(options).theme!.extend! } } as never)

const SOURCE = `import { prose } from 'styled-system/recipes'
export const article = prose()
export const large = prose({ size: 'lg' })
export const sized = (size) => prose({ size })
`

describe('the typography preset, compiled', () => {
  test.each([
    ['as written', {}],
    ['with notProse', { notProse: true }],
  ])('%s, under strictValues, with a rule behind every class', (_, options) => {
    const fixture = fixtureWith(options, { invalidDeclaration: 'error', strictValues: true, validation: 'error' })
    const result = fixture.foldStyleSets(SOURCE)

    expect(result.skipped).toEqual([])
    expect(result.folded.length).toBeGreaterThanOrEqual(2)
    // A size known only at run time is a lookup in a map of every state, built at compile time.
    expect(result.code).toContain('cvaMap(')

    const css = fixture.getStyleSetCss()
    for (const { className } of result.folded) {
      for (const selector of selectorsFor(className)) {
        expect(css, `${selector} has no rule`).toContain(selector)
      }
    }
  })

  test('meets the first child of the article as its own child, opting out with notProse', () => {
    const fixture = fixtureWith({ notProse: true }, { invalidDeclaration: 'error' })
    fixture.foldStyleSets(SOURCE)
    expect(fixture.getStyleSetCss()).toContain(
      ' > :first-child:not(:where([class~="not-prose"],[class~="not-prose"] *)) {',
    )
  })

  // The same key, merged by `cx`, so only the override ships for it — a heading of its own too,
  // which the recipe styles with the others.
  test('takes an override of an element, written as the recipe writes it', () => {
    const { foldStyleSets } = fixtureWith()
    const [call] = foldStyleSets(
      `import { prose } from 'styled-system/recipes'
import { css, cx } from 'styled-system/css'
export const article = cx(prose(), css({ '& a': { color: 'red.500' }, '& h2': { color: 'red.500' } }))
`,
    ).folded

    expect(call!.className).toContain('[&_a]:c_red.500')
    expect(call!.className).not.toContain('[&_a]:c_prose.link')
    expect(call!.className).toContain('[&_h2]:c_red.500')
    expect(call!.className).not.toContain('[&_h2]:c_prose.heading')
    expect(call!.className).toContain('[&_h3]:c_prose.heading')
  })

  test('writes its color tokens for light and dark', () => {
    const { ctx } = fixtureWith()
    const sheet = ctx.createSheet()
    ctx.appendCssOfType('tokens', sheet)
    const css = sheet.toCss()

    expect(css).toMatch(/--colors-prose-body: var\(--colors-neutral-700\)/)
    expect(css).toMatch(/--colors-prose-body: var\(--colors-neutral-300\)/)
  })

  // Listed and never called, it adds nothing to the stylesheet.
  test('changes nothing where prose() is never called', () => {
    const source = `import { css } from 'styled-system/css'\nexport const box = css({ color: 'red.500', padding: '4' })\n`
    const without = createFoldFixture()
    without.foldStyleSets(source)
    const withPreset = fixtureWith()
    withPreset.foldStyleSets(source)

    expect(withPreset.getStyleSetCss()).toBe(without.getStyleSetCss())
  })
})
