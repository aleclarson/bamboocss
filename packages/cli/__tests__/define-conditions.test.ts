import { expect, expectTypeOf, test } from 'vitest'
import { defineConditions, type ExtendableConditions } from '../src'

test('defineConditions takes the conditions of a config, and an extend of them', () => {
  const conditions = defineConditions({ dark: '.dark &', extend: { highContrast: '@media (forced-colors: active)' } })

  expect(conditions).toEqual({ dark: '.dark &', extend: { highContrast: '@media (forced-colors: active)' } })
  expectTypeOf(conditions).toEqualTypeOf<ExtendableConditions>()
  // @ts-expect-error A condition is a selector or an at-rule, never a number.
  defineConditions({ dark: 1 })
})
