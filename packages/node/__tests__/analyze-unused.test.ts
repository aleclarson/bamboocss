import { createContext } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { analyze } from '../src/analyze'

/**
 * `bamboo analyze --unused`: the configured names no source uses.
 *
 * Tokens and keyframes are what the build's own prune removes, run with every prune on — so a
 * name listed is one the stylesheet already ships without, and one the prune keeps for a reader
 * it cannot follow is not listed.
 */
const unused = async (
  code: string,
  config: Config = {},
  kinds?: Array<'tokens' | 'recipes' | 'patterns' | 'keyframes'>,
) => {
  const ctx = createContext({
    ...config,
    theme: {
      extend: {
        tokens: { colors: { brand: { 500: { value: '#0a0' } }, spare: { 500: { value: '#a00' } } } },
        semanticTokens: { colors: { primary: { value: 'token(colors.brand.500)' } } },
        keyframes: { idle: { from: { opacity: 0 }, to: { opacity: 1 } } },
      },
    },
  } as Config) as any
  ctx.project.addSourceFile('code.tsx', code)
  ctx.getFiles = () => ['code.tsx']
  return (await analyze(ctx)).getUnused(kinds)
}

const source = `
  import { css } from 'styled-system/css'
  import { stack } from 'styled-system/patterns'
  import { buttonStyle } from 'styled-system/recipes'

  export const a = css({ color: 'primary', animation: 'spin 1s linear infinite' })
  export const b = stack({ gap: '2' })
  export const c = buttonStyle()
`

describe('analyze --unused', () => {
  test('lists a token nothing reads, and not one read through another', async () => {
    const { tokens } = await unused(source)
    expect(tokens).toContain('colors.spare.500')
    expect(tokens, 'read by name').not.toContain('colors.primary')
    expect(tokens, 'read only through the semantic token that names it').not.toContain('colors.brand.500')
  })

  test('lists the keyframes, recipes and patterns nothing uses', async () => {
    const { keyframes, recipes, patterns } = await unused(source)
    expect(keyframes).toContain('idle')
    expect(keyframes).not.toContain('spin')
    expect(recipes).toContain('cardStyle')
    expect(recipes).not.toContain('buttonStyle')
    expect(patterns).toContain('grid')
    expect(patterns).not.toContain('stack')
  })

  // The prune keeps every token once a `token()` path cannot be read, so nothing is listed then:
  // a token said to be unused while something still asks for it is worse than no answer.
  test('lists no token when a token() path is built at runtime', async () => {
    const { tokens } = await unused(
      `${source}\nimport { token } from 'styled-system/tokens'\nexport const d = (name: string) => token(name as any)\n`,
    )
    expect(tokens).toEqual([])
  })

  test('whatever the config prunes itself', async () => {
    const { tokens, keyframes } = await unused(source, { prune: { tokens: false, keyframes: false } } as Config)
    expect(tokens).toContain('colors.spare.500')
    expect(keyframes).toContain('idle')
  })

  // Written from `theme.breakpoints`, and read by a condition as a value rather than a variable.
  test('lists no token a breakpoint is written as', async () => {
    const { tokens } = await unused(source)
    expect(tokens.some((name) => name.startsWith('breakpoints.') || name.startsWith('sizes.breakpoint-'))).toBe(false)
  })

  // Emitted for a consumer outside `include`, which no scan here can see calling it.
  test('lists no recipe or pattern staticCss emits regardless', async () => {
    const { recipes, patterns } = await unused(source, {
      staticCss: { recipes: { cardStyle: ['*'] }, patterns: { grid: ['*'] } },
    } as Config)
    expect(recipes).not.toContain('cardStyle')
    expect(patterns).not.toContain('grid')
  })

  // It only decides how loudly the prune says what it could not read, and a project that does not
  // prune tokens never hears it.
  test('is not failed by an unresolvedPath the config sets for a prune it does not run', async () => {
    const dynamic = `${source}\nimport { token } from 'styled-system/tokens'\nexport const d = (name: string) => token(name as any)\n`
    await expect(
      unused(dynamic, { prune: { tokens: false, unresolvedPath: 'error' } } as Config),
    ).resolves.toBeDefined()
  })

  test('answers only for the kinds asked', async () => {
    expect(await unused(source, {}, ['recipes'])).toMatchObject({ tokens: [], keyframes: [], patterns: [] })
    expect((await unused(source, {}, ['recipes'])).recipes).toContain('cardStyle')
  })
})
