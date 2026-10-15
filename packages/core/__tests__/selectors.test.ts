import { describe, test, expect } from 'vitest'
import { isCompound, nestingParent } from '../src/parent-selector'
import { extractParentSelectors } from '../src/selector'

describe('selectors', () => {
  test('multiple - should extract parent selector', () => {
    const selectors = extractParentSelectors('&&.dark, .dark &, &[data-theme=dark], [data-theme="dark"] &')
    expect(selectors).toMatchInlineSnapshot(`":where(.dark, [data-theme="dark"])"`)
  })

  test('single - should not wrap in :where', () => {
    const selectors = extractParentSelectors('[data-theme="dark"] &')
    expect(selectors).toMatchInlineSnapshot(`"[data-theme="dark"]"`)
  })

  // A ` &` in a quoted value is the value's: it was taken off as the nesting, and the attribute
  // matched a different value.
  test('keeps a quoted ` &`', () => {
    expect(extractParentSelectors('[data-a="a &"] &')).toBe('[data-a="a &"]')
  })

  test('the ancestor a `P &` nests under', () => {
    expect(nestingParent('.dark &')).toBe('.dark')
    expect(nestingParent('  .app .dark   &  ')).toBe('.app .dark')
    expect(nestingParent('[data-mode="a & b"] &'), 'a quoted `&` is the value’s').toBe('[data-mode="a & b"]')
    expect(nestingParent('.dark > &'), 'a combinator of its own').toBeUndefined()
    expect(nestingParent('.toggle:checked ~ &')).toBeUndefined()
    expect(nestingParent('.dark & .panel'), 'a parent not last').toBeUndefined()
    expect(nestingParent('.dark & &')).toBeUndefined()
    expect(nestingParent('&.dark')).toBeUndefined()
    expect(nestingParent('.dark&'), 'compounded, not nested').toBeUndefined()
    expect(nestingParent('.a\\ &'), 'an escaped space').toBeUndefined()
    expect(nestingParent(' &')).toBeUndefined()
  })

  test('one compound, or several', () => {
    expect(isCompound('.dark')).toBe(true)
    expect(isCompound('html.dark:not(.light)')).toBe(true)
    expect(isCompound('[data-mode="a b"]'), 'a quoted space').toBe(true)
    expect(isCompound('[ data-mode = dark ]'), 'spaces in an attribute').toBe(true)
    expect(isCompound(':is(.a .b)'), 'a complex argument').toBe(true)
    expect(isCompound('.a\\ .b'), 'an escaped space').toBe(true)
    expect(isCompound('.app .dark')).toBe(false)
    expect(isCompound('.app>.dark')).toBe(false)
    expect(isCompound('.a + .b')).toBe(false)
  })
})
