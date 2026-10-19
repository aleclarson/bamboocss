import { describe, expect, test } from 'vitest'
import { getFixtureProject, parseAndExtract, parseFile } from './fixture'

/**
 * `keyframes()` returns a name the build computes, and two things have to agree on it: the
 * style objects that read the call, which the evaluator folds the name into, and the block the
 * stylesheet writes. An animation naming no block is valid CSS that never plays, so each test
 * asserts the name on both sides.
 *
 * The names are pinned literally: `kf_feVUdh` is `toHash(JSON.stringify(stops))` for the stops
 * most of these use.
 */
const FADE = `{ from: { opacity: 0 }, to: { opacity: 1 } }`

describe('keyframes', () => {
  test('writes the block under the name a style object reading the call animates', () => {
    const code = `
    import { css, keyframes } from 'styled-system/css'

    const fadeIn = keyframes(${FADE})
    const styles = css({ animationName: fadeIn })
    `

    const { css } = parseAndExtract(code)
    expect(css).toMatch(/@keyframes kf_feVUdh \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/)
    expect(css).toMatch(/animation-name: kf_feVUdh;/)
  })

  test('the name reads into a template literal', () => {
    const code = `
    import { css, keyframes } from 'styled-system/css'

    const fadeIn = keyframes(${FADE})
    const styles = css({ animation: \`\${fadeIn} 0.2s ease-out\` })
    `

    expect(parseAndExtract(code).css).toMatch(/animation: kf_feVUdh 0\.2s ease-out;/)
  })

  test('a token and a utility inside a stop resolve as they do in a style object', () => {
    const code = `
    import { keyframes } from 'styled-system/css'

    const flash = keyframes({ from: { color: 'red.300' }, to: { color: 'green.300' } })
    `

    const { css } = parseAndExtract(code)
    expect(css).toContain('color: var(--colors-red-300)')
    expect(css).toContain('color: var(--colors-green-300)')
  })

  test('the block lands in the tokens layer, beside the theme keyframes', () => {
    const code = `
    import { keyframes } from 'styled-system/css'
    const fadeIn = keyframes(${FADE})
    `

    expect(parseAndExtract(code).css).toMatch(/^@layer tokens \{\s*@keyframes kf_feVUdh/)
  })

  test('two calls with the same stops write one block', () => {
    const code = `
    import { keyframes } from 'styled-system/css'

    const a = keyframes(${FADE})
    const b = keyframes(${FADE})
    `

    expect(parseAndExtract(code).css.match(/@keyframes/g)).toHaveLength(1)
  })

  // A stop written twice, as `from` and `0%`, is resolved by which comes later, so the order the
  // stops were written in is part of what they are.
  test('the same stops written in another order are another block', () => {
    const code = `
    import { keyframes } from 'styled-system/css'

    const a = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
    const b = keyframes({ to: { opacity: 1 }, from: { opacity: 0 } })
    `

    const { css } = parseAndExtract(code)
    expect(css).toContain('@keyframes kf_feVUdh')
    expect(css).toContain('@keyframes kf_bFzusB')
  })

  test.each([
    ['undefined', 'undefined'],
    ['null', 'null'],
  ])('a %s declaration names the block as an absent one does', (_label, spelling) => {
    const code = `
    import { css, keyframes } from 'styled-system/css'

    const fadeIn = keyframes({ from: { opacity: 0, color: ${spelling} }, to: { opacity: 1 } })
    const styles = css({ animationName: fadeIn })
    `

    const { css } = parseAndExtract(code)
    expect(css).toContain('@keyframes kf_feVUdh')
    expect(css).toMatch(/animation-name: kf_feVUdh;/)
  })

  test('records the call in the parser result', () => {
    const code = `
    import { keyframes } from 'styled-system/css'
    const fadeIn = keyframes(${FADE})
    `

    expect(parseAndExtract(code).json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "from": {
                "opacity": 0,
              },
              "to": {
                "opacity": 1,
              },
            },
          ],
          "name": "keyframes",
          "type": "keyframes",
        },
      ]
    `)
  })

  test('an aliased import and a namespace import are still extracted', () => {
    const aliased = `
    import { keyframes as kf } from 'styled-system/css'
    const fadeIn = kf(${FADE})
    `
    const namespaced = `
    import * as bamboo from 'styled-system/css'
    const fadeIn = bamboo.keyframes(${FADE})
    `

    expect(parseAndExtract(aliased).css).toContain('@keyframes kf_feVUdh')
    expect(parseAndExtract(namespaced).css).toContain('@keyframes kf_feVUdh')
  })

  test('a local keyframes that is not the import is left alone', () => {
    const code = `
    const keyframes = (stops) => 'not-bamboo'
    const fadeIn = keyframes(${FADE})
    `

    expect(parseAndExtract(code).css).toBe('')
  })

  test('the name carries the class prefix', () => {
    const code = `
    import { css, keyframes } from 'styled-system/css'

    const fadeIn = keyframes(${FADE})
    const styles = css({ animationName: fadeIn })
    `

    const { css } = parseAndExtract(code, { prefix: 'app' })
    expect(css).toContain('@keyframes app-kf_feVUdh')
    expect(css).toMatch(/animation-name: app-kf_feVUdh;/)
  })

  // No name is the one the call returns, so neither the block nor a declaration naming it.
  test('stops the build cannot read whole write nothing, and say why', () => {
    const code = `
    import { keyframes } from 'styled-system/css'

    export const fade = (to: number) => keyframes({ from: { opacity: 0 }, to: { opacity: to } })
    `

    const { css, parserResult } = parseAndExtract(code)
    expect(css).toBe('')
    expect(parserResult.unresolved).toEqual([
      expect.objectContaining({ kind: 'keyframes', reason: 'unresolvable-value', line: 4 }),
    ])
  })

  test('a style object reading such a call loses the declaration too', () => {
    const code = `
    import { css, keyframes } from 'styled-system/css'

    export const fade = (to: number) => {
      const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: to } })
      return css({ animationName: fadeIn })
    }
    `

    const { css, parserResult } = parseAndExtract(code)
    expect(css).toBe('')
    expect(parserResult.unresolved.map((entry) => entry.kind).sort()).toEqual(['atomic', 'keyframes'])
  })

  test('a name exported from one file animates in another', () => {
    const ctx = getFixtureProject(`
    import { css } from 'styled-system/css'
    import { fadeIn } from './animations'

    export const styles = css({ animationName: fadeIn })
    `)
    ctx.project.addSourceFile(
      'app/src/animations.ts',
      `
      import { keyframes } from 'styled-system/css'
      export const fadeIn = keyframes(${FADE})
      `,
    )

    const encoder = ctx.encoder.clone()
    parseFile(ctx, 'app/src/test.tsx', encoder)
    parseFile(ctx, 'app/src/animations.ts', encoder)
    const css = ctx.getParserCss(ctx.decoder.clone().collect(encoder))

    expect(css).toContain('@keyframes kf_feVUdh')
    expect(css).toMatch(/animation-name: kf_feVUdh;/)
  })
})
