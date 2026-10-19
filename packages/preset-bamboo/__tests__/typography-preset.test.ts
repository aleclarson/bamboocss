import { describe, expect, test } from 'vitest'
import { typographyPreset } from '../src'
import { SIZES } from '../src/prose/constants'
import { createProseRecipe } from '../src/prose/recipe'
import { assembleStyles } from '../src/prose/styles'

type Styles = Record<string, Record<string, string>>

/**
 * The opt-in typography preset: a `prose` recipe for Markdown and CMS HTML, ported from Panda's,
 * with every value outside the theme written as `[value]` and token references as `token()`.
 */
describe('typographyPreset', () => {
  test('adds a prose recipe and the color tokens it reads', () => {
    const preset = typographyPreset()

    expect(preset.name).toBe('@bamboocss/preset-bamboo/typography')
    expect(preset.theme?.extend?.recipes?.prose).toMatchObject({ className: 'prose', defaultVariants: { size: 'md' } })
    expect(Object.keys(preset.theme?.extend?.recipes?.prose?.variants?.size ?? {})).toEqual([...SIZES])
    const colors = preset.theme?.extend?.semanticTokens?.colors?.prose as Record<string, { value: unknown }>
    expect(colors.body!.value).toEqual({ base: 'token(colors.neutral.700)', _dark: 'token(colors.neutral.300)' })
  })

  // A curly reference is retired syntax, which a config holding one fails to load with.
  test('references tokens with token() alone', () => {
    expect(JSON.stringify(typographyPreset())).not.toMatch(/\{(colors|sizes|spacing|fontSizes)\./)
  })

  test('limits the sizes and picks the default one', () => {
    const recipe = typographyPreset({ sizes: ['sm', 'lg'], defaultSize: 'lg' }).theme?.extend?.recipes?.prose
    expect(Object.keys(recipe?.variants?.size ?? {})).toEqual(['sm', 'lg'])
    expect(recipe?.defaultVariants).toEqual({ size: 'lg' })
  })

  test('refuses a default size it does not generate, and no sizes at all', () => {
    expect(() => typographyPreset({ sizes: ['sm'], defaultSize: 'lg' })).toThrow(/defaultSize/)
    expect(() => typographyPreset({ sizes: [] })).toThrow(/at least one size/)
  })

  test('renames the recipe, its class and the token prefix', () => {
    const preset = typographyPreset({
      name: 'article',
      className: 'rich-text',
      semanticTokens: { prefix: 'copy', colorPalette: 'gray' },
    })

    expect(preset.theme?.extend?.recipes?.article).toMatchObject({ className: 'rich-text' })
    expect(preset.theme?.extend?.recipes?.prose).toBeUndefined()
    const colors = preset.theme?.extend?.semanticTokens?.colors?.copy as Record<string, { value: unknown }>
    expect(colors.body!.value).toEqual({ base: 'token(colors.gray.700)', _dark: 'token(colors.gray.300)' })
    expect(preset.theme?.extend?.recipes?.article?.base?.color).toBe('copy.body')
  })

  test('leaves the color tokens out when they are disabled', () => {
    expect(typographyPreset({ semanticTokens: { enabled: false } }).theme?.extend?.semanticTokens).toBeUndefined()
  })

  test('lets content opt out of prose with notProse', () => {
    const keys = Object.keys(createProseRecipe({ notProse: true }).prose!.base ?? {})
    expect(keys.some((key) => key.includes(':where(a)') && key.includes('not-prose'))).toBe(true)
    expect(keys).not.toContain('& a')
    expect(Object.keys(createProseRecipe({ notProse: 'skip-prose' }).prose!.base ?? {}).join()).toContain('skip-prose')
  })

  // `:where()` takes no combinator first: `:where(> :first-child)`, as Panda writes it, matched nothing.
  test('keeps a part opening with a combinator outside :where()', () => {
    const keys = Object.keys(createProseRecipe({ notProse: true }).prose!.base ?? {})
    expect(keys).toContain('& > :first-child:not(:where([class~="not-prose"],[class~="not-prose"] *))')
    expect(keys.join()).not.toMatch(/:where\(\s*[>+~]/)
  })

  // Under keys of their own, so `cx(prose(), css({ '& h2': … }))` merges over the recipe's `h2`.
  test('nests each element styled under a key of its own', () => {
    expect(
      assembleStyles({
        root: { color: 'red' },
        elements: { p: { marginBlockStart: '1rem' }, 'h1, h2': { fontWeight: 'bold' }, h2: { fontSize: '1.5em' } },
      }),
    ).toEqual({
      color: 'red',
      '& p': { marginBlockStart: '1rem' },
      '& h1': { fontWeight: 'bold' },
      '& h2': { fontWeight: 'bold', fontSize: '1.5em' },
    })
    expect(Object.keys(createProseRecipe().prose!.base ?? {}).filter((key) => key.includes(','))).toEqual([])
  })

  // Content streamed in after earlier blocks never restyles them.
  test('styles no block by what comes after it', () => {
    const recipe = createProseRecipe().prose!
    for (const styles of [recipe.base, ...Object.values(recipe.variants?.size ?? {})] as Record<string, unknown>[]) {
      for (const [selector, value] of Object.entries(styles)) {
        expect(selector).not.toMatch(/:last-child|:has\(|:empty|:nth-last/)
        if (typeof value === 'object' && value !== null) {
          expect(value).not.toHaveProperty('marginBlockEnd')
          expect(value).not.toHaveProperty('marginBlock')
        }
      }
    }
  })

  test('inherits the page font, and sets mono on code alone', () => {
    const base = createProseRecipe().prose!.base as Styles
    expect(base.fontFamily).toBeUndefined()
    expect(base['& code']).toMatchObject({ fontFamily: 'mono' })
    expect(base['& pre']).toMatchObject({ fontFamily: 'mono' })
  })

  test('puts inline code on its own background, and resets code inside pre', () => {
    const base = createProseRecipe().prose!.base as Styles
    expect(base['& code']).toMatchObject({
      backgroundColor: 'prose.codeBg',
      paddingInline: '[0.3em]',
      borderRadius: 'sm',
    })
    expect(base['& pre code']).toMatchObject({ backgroundColor: 'transparent', padding: '0' })
    expect(base['& pre']).toMatchObject({
      scrollbarWidth: 'thin',
      scrollbarColor: '[token(colors.prose.hrBorder) transparent]',
    })
  })

  test('separates table body rows with a border on each following row', () => {
    const base = createProseRecipe().prose!.base as Styles
    expect(base['& tbody tr + tr']).toMatchObject({ borderTopWidth: '[1px]' })
    expect(base['& tbody tr']).toBeUndefined()
  })

  test('sizes the root alone, and everything inside as a ratio of it', () => {
    const recipe = createProseRecipe().prose!
    expect(recipe.variants?.size?.md).toEqual({ fontSize: 'md' })
    expect(recipe.variants?.size?.['2xl']).toEqual({ fontSize: '2xl' })

    const base = recipe.base as Styles
    expect(base['& p']).toMatchObject({ marginBlockStart: '[var(--prose-flow)]' })
    // 2.4 body-ems over the heading's own 1.5em, so the `em` substituted lands on the body's size.
    expect(base['& h2']).toMatchObject({ fontSize: '[1.5em]', marginBlockStart: '[calc(var(--prose-flow) * 1.6)]' })
    expect(base['& pre']).toMatchObject({ marginBlockStart: '[calc(var(--prose-flow) * 1.3714)]' })
  })

  test('keeps its rhythm in two custom properties on the root', () => {
    const base = createProseRecipe().prose!.base as Record<string, unknown>
    expect(base['--prose-leading']).toBe('[1.625]')
    expect(base['--prose-flow']).toBe('[1.25em]')
    expect(base.lineHeight).toBe('[var(--prose-leading)]')
    expect((createProseRecipe({ name: 'article' }).article!.base as Record<string, unknown>)['--article-flow']).toBe(
      '[1.25em]',
    )
  })

  // So an article scales with whatever its container sets.
  test('sizes no element in rem, px or a size token', () => {
    const offenders: string[] = []
    for (const [selector, value] of Object.entries(createProseRecipe().prose!.base as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      for (const [prop, raw] of Object.entries(value as Record<string, string>)) {
        if (
          /^(fontSize|lineHeight|margin|padding)/.test(prop) &&
          /rem|px|token\((spacing|fontSizes|lineHeights)\./.test(raw)
        ) {
          offenders.push(`${selector} ${prop}: ${raw}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
