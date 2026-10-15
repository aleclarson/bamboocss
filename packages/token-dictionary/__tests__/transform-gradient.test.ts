import { expect, test } from 'vitest'
import { TokenDictionary } from '../src/dictionary'
import { transformGradient } from '../src/transform'

test('transform / gradient', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: {
        pink: { value: '#ff00ff' },
      },
      gradients: {
        primary: {
          value: {
            type: 'linear',
            placement: 'to top',
            stops: [
              { color: '#ff0000', position: 0 },
              { color: 'token(colors.pink)', position: 100 },
            ],
          },
        },
      },
    },
  })

  dictionary.registerTokens()
  dictionary.registerTransform(transformGradient)

  dictionary.build()

  expect(dictionary.allTokens).toMatchInlineSnapshot(`
    [
      Token {
        "deprecated": undefined,
        "description": undefined,
        "extensions": {
          "category": "colors",
          "condition": "base",
          "prop": "pink",
        },
        "name": "colors.pink",
        "originalValue": "#ff00ff",
        "path": [
          "colors",
          "pink",
        ],
        "type": "color",
        "value": "#ff00ff",
      },
      Token {
        "deprecated": undefined,
        "description": undefined,
        "extensions": {
          "category": "gradients",
          "condition": "base",
          "prop": "primary",
        },
        "name": "gradients.primary",
        "originalValue": "linear-gradient(to top, #ff0000 0px, token(colors.pink) 100px)",
        "path": [
          "gradients",
          "primary",
        ],
        "type": "gradient",
        "value": "linear-gradient(to top, #ff0000 0px, #ff00ff 100px)",
      },
    ]
  `)
})

// A number is an angle, which the docs allow: it matched no composite gradient, and the token's
// value reached the stylesheet as an object.
const gradient = (value: unknown, semantic = false) => {
  const dictionary = new TokenDictionary({
    [semantic ? 'semanticTokens' : 'tokens']: { gradients: { g: { value } } },
  } as never)
  dictionary.registerTokens()
  dictionary.registerTransform(transformGradient)
  dictionary.build()
  return dictionary.allTokens.filter((token) => token.name === 'gradients.g').map((token) => token.value)
}

test('transform / gradient with an angle', () => {
  expect(gradient({ type: 'linear', placement: 90, stops: ['red', 'blue'] })).toEqual([
    'linear-gradient(90deg, red, blue)',
  ])
  expect(gradient({ type: 'conic', placement: 45, stops: ['red', 'blue'] }), 'after `from`').toEqual([
    'conic-gradient(from 45deg, red, blue)',
  ])
  const stops = [
    { color: 'red', position: 0 },
    { color: 'blue', position: 100 },
  ]
  expect(gradient({ type: 'linear', placement: 90, stops }), 'with stops placed').toEqual([
    'linear-gradient(90deg, red 0px, blue 100px)',
  ])
})

// A semantic gradient was read as a map of conditions named `type`, `placement` and `stops`.
test('transform / a semantic gradient with an angle, and one for a condition', () => {
  const linear = { type: 'linear', placement: 90, stops: ['red', 'blue'] }
  expect(gradient(linear, true)).toEqual(['linear-gradient(90deg, red, blue)'])
  expect(gradient({ base: linear, _dark: { ...linear, placement: 270 } }, true)).toEqual([
    'linear-gradient(90deg, red, blue)',
    'linear-gradient(270deg, red, blue)',
  ])
})

// No angle places a radial gradient, so it is an error rather than css the browser drops.
test('transform / a radial gradient with an angle is an error', () => {
  expect(() => gradient({ type: 'radial', placement: 90, stops: ['red', 'blue'] })).toThrow(/circle at top/)
  expect(() => gradient({ type: 'linear', placement: Number.NaN, stops: ['red', 'blue'] })).toThrow(/no angle/)
})
