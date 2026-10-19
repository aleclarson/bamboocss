import { describe, expect, test } from 'vitest'
import { createRuleProcessor } from './fixture'

const cssOf = (styles: Record<string, unknown>) => createRuleProcessor().css(styles).toCss()

/**
 * Conditions ported from Panda 2: the pointer a device has, whether a field is valid once the user
 * has interacted with it, and an inert subtree.
 */
describe('preset conditions', () => {
  test.each([
    ['_pointerFine', '@media (pointer: fine)'],
    ['_pointerCoarse', '@media (pointer: coarse)'],
    ['_pointerNone', '@media (pointer: none)'],
    ['_anyPointerFine', '@media (any-pointer: fine)'],
    ['_anyPointerCoarse', '@media (any-pointer: coarse)'],
    ['_anyPointerNone', '@media (any-pointer: none)'],
  ])('%s is %s', (condition, query) => {
    expect(cssOf({ [condition]: { padding: '4' } })).toContain(`${query} {`)
  })

  test.each([
    ['_userValid', ':is(:user-valid, [data-user-valid])'],
    ['_userInvalid', ':is(:user-invalid, [data-user-invalid])'],
    ['_inert', ':is([inert], [data-inert])'],
  ])('%s matches %s', (condition, selector) => {
    expect(cssOf({ [condition]: { opacity: '0.5' } })).toMatch(
      new RegExp(`${selector.replace(/[[\]():,]/g, '\\$&')} \\{`),
    )
  })
})
