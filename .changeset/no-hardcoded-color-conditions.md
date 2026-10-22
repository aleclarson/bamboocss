---
'@bamboocss/eslint-plugin': patch
---

`no-hardcoded-color` reads a property's condition object. `css({ color: { base: 'red.500', _hover: '#dc2626' } })`
reported nothing, so the recommended config let through any colour given per breakpoint or state that way; only the
other spelling, `_hover: { color: '#dc2626' }`, was read.

- A value is judged as the same value written plain, however deep the conditions nest, in `css()`, `cva` and `sva`
  styles alike. A quoted key, `'color': '#ef4444'`, is read like any other.
- A variant being chosen is no longer reported: the argument a recipe is called with, `defaultVariants` and a compound
  variant's conditions name a variant, and `button({ color: 'loud' })` was reported as a hardcoded colour.
- Nor is a computed key, which was read as the name of its variable: with `const color = 'padding'`,
  `css({ [color]: '4' })` was reported.
