import { describe, expect, test } from 'vitest'
import { css, cva, sva } from '../styled-system/css'
import { aspectRatio, divider, float, grid } from '../styled-system/patterns'

/** A `boolean` the checker cannot narrow, and `false` when it runs. */
const maybe = Math.random() < 0

/**
 * Every optional key the generated types declare takes `undefined`, as one is written when a value
 * is passed on or left out: `_hover: active ? { … } : undefined`.
 *
 * Under `exactOptionalPropertyTypes`, which this sandbox's `tsconfig.json` turns on, `?:` alone
 * does not take it. A condition block, a utility with no css property behind it, a pattern's own
 * props and a recipe's `base` each rejected one. Enforced by `pnpm codegen typecheck`.
 */
describe('under exactOptionalPropertyTypes', () => {
  test('a style object takes `undefined` wherever a key is optional', () => {
    const styles = [
      css.raw({ _hover: maybe ? { color: 'red.300' } : undefined }),
      css.raw({ md: undefined, '&:hover': undefined }),
      css.raw({ colorPalette: undefined, srOnly: undefined, truncate: undefined, boxSize: undefined }),
      css.raw({ color: { base: 'red.300', _hover: undefined } }),
      grid.raw({ columns: undefined, minChildWidth: undefined }),
      divider.raw({ orientation: undefined }),
      float.raw({ offset: undefined, placement: undefined }),
      aspectRatio.raw({ ratio: undefined }),
    ]

    expect(styles).toHaveLength(8)
  })

  test('a recipe takes `undefined` for what it leaves out', () => {
    const recipes = [
      cva({ base: maybe ? { color: 'red.300' } : undefined, variants: undefined, defaultVariants: undefined }),
      sva({ slots: ['root'], base: undefined, compoundVariants: undefined }),
      // And for a slot, in each record keyed by them.
      sva({
        slots: ['root', 'label'],
        base: { root: maybe ? { color: 'red.300' } : undefined },
        variants: { size: { sm: { label: undefined } } },
        compoundVariants: [{ size: 'sm', css: { root: undefined } }],
      }),
    ]

    expect(recipes).toHaveLength(3)
  })
})
