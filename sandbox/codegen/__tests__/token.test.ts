import { describe, expect, expectTypeOf, test } from 'vitest'
import { token, type LiteralToken } from '../styled-system/tokens'

describe('token.value()', () => {
  /** Typed `string`, it failed a prop taking a number and let a string method through. */
  test('returns the number a token holds, typed as one', () => {
    expect(token.value('zIndex.modal')).toBe(1400)
    expect(token.value('zIndex.hide')).toBe(-1)
    expectTypeOf(token.value('zIndex.modal')).toEqualTypeOf<number>()
    expectTypeOf(token.value('colors.red.300')).toEqualTypeOf<string>()
  })

  test('gives a path that may name either kind both', () => {
    const read = (path: LiteralToken) => token.value(path)
    const colour = (path: Extract<LiteralToken, `colors.${string}`>) => token.value(path)

    expectTypeOf(read).returns.toEqualTypeOf<string | number>()
    expectTypeOf(colour).returns.toEqualTypeOf<string>()
    expect(read('zIndex.base')).toBe(0)
  })
})
