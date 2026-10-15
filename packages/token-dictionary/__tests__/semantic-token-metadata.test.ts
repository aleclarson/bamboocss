import { describe, expect, test } from 'vitest'
import { TokenDictionary } from '../src/dictionary'

/**
 * What a semantic token says about itself, however its value is written.
 *
 * A value written as a string was wrapped as `{ base }` by building a new token around it, which
 * left everything else the token carried behind: its `description` never reached the spec, the
 * MCP server or the editor, `deprecated` never reached the lint rule, and a plugin reading its
 * `extensions` found none. Written as a condition map, the same token kept all three.
 */
const tokens = {
  colors: { red: { 200: { value: '#f99' }, 500: { value: '#f00' } } },
  spacing: { 4: { value: '1rem', deprecated: 'Use `spacing.5`' } },
}

const metadata = {
  description: 'For destructive actions',
  deprecated: 'Use `critical`',
  extensions: { figma: 'Danger' },
}

const create = (semanticTokens: object, options: object = {}) => {
  const dictionary = new TokenDictionary({ tokens, semanticTokens, ...options } as never)
  dictionary.init()
  return dictionary
}

const declared = (dictionary: TokenDictionary, name: string) =>
  dictionary.allTokens.filter((token) => token.name === name)

describe('a semantic token keeps its description, deprecation and extensions', () => {
  test.each([
    ['a string', 'colors', '{colors.red.500}'],
    ['a number', 'zIndex', 100],
    ['a composite value', 'borders', { width: '1px', style: 'solid', color: '{colors.red.500}' }],
    ['a condition map', 'colors', { base: '{colors.red.500}', _dark: '{colors.red.200}' }],
  ])('written as %s', (_, category, value) => {
    const dictionary = create({ [category]: { danger: { value, ...metadata } } })
    const name = `${category}.danger`

    expect(declared(dictionary, name).length).toBeGreaterThan(0)
    for (const token of declared(dictionary, name)) {
      expect(token).toMatchObject({ description: metadata.description, deprecated: metadata.deprecated })
      expect(token.extensions.figma).toBe('Danger')
    }
    expect(dictionary.isDeprecated(name)).toBe(true)
  })

  // Each condition is its own token, cloned from the one declared; the clone dropped `deprecated`.
  test('in the token for each of its conditions', () => {
    const dictionary = create({
      colors: { danger: { value: { base: '{colors.red.500}', _dark: '{colors.red.200}' }, ...metadata } },
    })
    const dark = declared(dictionary, 'colors.danger').find((token) => token.extensions.condition === '_dark')

    expect(dark).toMatchObject({ deprecated: metadata.deprecated, description: metadata.description })
  })

  // A theme overrides the token under the theme's condition; what it says of the token goes with it.
  test('as a theme overrides it', () => {
    const dictionary = create(
      { colors: { bg: { value: '#fff' } } },
      { themes: { dark: { semanticTokens: { colors: { bg: { value: '#000', description: 'Dark surface' } } } } } },
    )
    const themed = declared(dictionary, 'colors.bg').find((token) => token.extensions.theme === 'dark')

    expect(themed?.description).toBe('Dark surface')
  })
})

describe('the extensions are the config’s, and stay so', () => {
  test('not written into, frozen or not', () => {
    const extensions = Object.freeze({ figma: 'Danger' })
    const dictionary = create({ colors: { danger: { value: '{colors.red.500}', extensions } } })

    expect(declared(dictionary, 'colors.danger')[0]?.extensions.figma).toBe('Danger')
    expect(extensions).toEqual({ figma: 'Danger' })
  })

  // The dictionary decides which condition a token it declares is for; the token is the base one.
  test('the condition is not theirs to set', () => {
    const plain = create({ colors: { danger: { value: '{colors.red.500}' } } })
    const claimed = create({ colors: { danger: { value: '{colors.red.500}', extensions: { condition: '_dark' } } } })

    expect(declared(claimed, 'colors.danger')[0]?.extensions.condition).toBe('base')
    expect([...claimed.view.vars.keys()]).toEqual([...plain.view.vars.keys()])
    expect(claimed.view.vars.get('base')?.get('--colors-danger')).toBe(
      plain.view.vars.get('base')?.get('--colors-danger'),
    )
  })
})

// A negative spacing token is the positive one with its sign turned: deprecating one deprecates both.
test('a negative spacing token is as deprecated as the one it negates', () => {
  const dictionary = create({})

  expect(dictionary.isDeprecated('spacing.4')).toBe(true)
  expect(dictionary.isDeprecated('spacing.-4')).toBe(true)
})
