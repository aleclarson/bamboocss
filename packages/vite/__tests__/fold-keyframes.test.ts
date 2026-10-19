import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * `keyframes()` folds to the name of its block. The name is computed once, by the analysis, and
 * the same function names the block extraction writes, so these tests check the rewritten source
 * and the stylesheet against each other rather than against a hash computed here.
 */
describe('keyframes', () => {
  test('a call is replaced by the name of the block the stylesheet writes', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { css, keyframes } from 'styled-system/css'
      export const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
      export const className = css({ animation: \`\${fadeIn} 0.2s ease-out\` })
    `)

    expect(result.code).toContain('export const fadeIn = "kf_feVUdh"')
    expect(result.code).not.toContain('keyframes(')
    expect(result.folded).toContainEqual(
      expect.objectContaining({ name: 'keyframes', kind: 'value', value: 'kf_feVUdh' }),
    )
    expect(result.skipped).toEqual([])

    const css = fixture.getStyleSetCss()
    expect(css).toContain('@keyframes kf_feVUdh')
    expect(css).toMatch(/animation: kf_feVUdh 0\.2s ease-out/)
  })

  test('a call written inside the style object folds there too', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { css, keyframes } from 'styled-system/css'
      export const className = css({ animationName: keyframes({ to: { transform: 'rotate(360deg)' } }) })
    `)

    expect(result.code).not.toContain('keyframes(')
    // Inside the `css()` the fold replaces whole, so it is that call's to rewrite.
    expect(result.skipped).toEqual([expect.objectContaining({ name: 'keyframes', reason: 'overlapping' })])
    const css = fixture.getStyleSetCss()
    expect(css).toContain('@keyframes kf_fcamfv')
    expect(css).toMatch(/animation-name: kf_fcamfv/)
  })

  test('a call inside a recipe config is erased with the declaration', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { cva, keyframes } from 'styled-system/css'
      const spinner = cva({ base: { animation: \`\${keyframes({ to: { rotate: '360deg' } })} 1s linear infinite\` } })
      export const className = spinner()
    `)

    expect(result.code).toContain('const spinner = undefined')
    expect(result.skipped).toEqual([expect.objectContaining({ name: 'keyframes', reason: 'overlapping' })])
    const css = fixture.getStyleSetCss()
    const name = css.match(/@keyframes (kf_\w+)/)?.[1]
    expect(name).toBeDefined()
    expect(css).toContain(`animation: ${name} 1s linear infinite`)
  })

  test('the name carries the class prefix', () => {
    const fixture = createFoldFixture({ prefix: 'app' })
    const result = fixture.foldStrict(`
      import { keyframes } from 'styled-system/css'
      export const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
    `)

    expect(result.code).toContain('"app-kf_feVUdh"')
    expect(fixture.getStyleSetCss()).toContain('@keyframes app-kf_feVUdh')
  })

  test('refuses stops it cannot read whole rather than retaining the runtime', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { keyframes } from 'styled-system/css'
      export const fade = (to) => keyframes({ from: { opacity: 0 }, to: { opacity: to } })
    `)

    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        name: 'keyframes',
        reason: 'dynamic',
        detail: 'the name it returns is a hash of its stops, so they have to be known at build time',
      }),
    )
  })

  test('a local keyframes that is not the import is left alone', () => {
    const fixture = createFoldFixture()
    const code = `
      const keyframes = (stops) => 'mine'
      export const fadeIn = keyframes({ from: { opacity: 0 } })
    `
    const result = fixture.foldStrict(code)

    expect(result.folded).toEqual([])
    expect(result.code).toBe(code)
    expect(fixture.getStyleSetCss()).not.toContain('@keyframes')
  })
})
