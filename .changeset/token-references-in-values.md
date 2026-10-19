---
'@bamboocss/core': patch
'@bamboocss/token-dictionary': patch
'@bamboocss/generator': patch
'@bamboocss/eslint-plugin': patch
'@bamboocss/types': patch
---

A `token()` reference naming no token fails the build, as a bare value naming none already did. Written inside a value,
`border: '1px solid token(colors.nope)'`, it reached the stylesheet as text rather than a variable, so the declaration
never took a token's value. In a `calc()`, a custom property, a `var()` fallback or `font-family` nothing reported it at
all. It is graded by the token half of `unresolvedToken`, so `warn` reports it without failing, and a reference written
without its category, `token(red.300)`, is reported with the path it was probably meant to be.

- A token typo fixed in source, in a `css()`, `cva`, `sva`, `keyframes()` call or view transition, no longer keeps
  failing every rebuild of a dev server or `--watch` until it restarts.
- `no-invalid-token-paths` reads a value under `base` and a quoted key such as `'--accent'`, judges a value under a
  condition against the property holding it, and no longer reports a colour with an opacity, `token(colors.red.300/50)`,
  while still reporting an opacity the build cannot read.
