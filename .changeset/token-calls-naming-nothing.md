---
'@bamboocss/core': patch
'@bamboocss/generator': patch
'@bamboocss/node': patch
'@bamboocss/eslint-plugin': patch
'@bamboocss/vite': patch
'@bamboocss/types': patch
---

A `token()` or `token.value()` call naming no token fails `bamboo cssgen` and every other build that writes the
stylesheet, as a `token()` reference in a value naming none does. `css({ color: token('colors.nope') })` returns
`undefined`, and the build read it the same way: `color` was dropped with no rule and no message. It is graded by the
token half of `unresolvedToken`, so `warn` reports it without failing, and is listed in the same error as the values,
with where each call is and the path it was probably meant to be, `token('colors.red.300')` for `token('red.300')`.

- A path the build reads through a constant or enumerates from a ternary is judged. One known only at runtime, one the
  build only guessed, and a call whose result is tested or defaulted — `token('colors.brand') ?? '#fff'` — are not.
- The retired fallback argument, `token('colors.red.300', '#fff')`, is no longer recorded as a second token path.
- `no-invalid-token-paths` reports these calls in the editor, from the build's own extraction and in its words. It
  shares that extraction with `no-unresolved-styles`, so a file is read once for both.
- Under Vite such a call already failed to compile, as `token() — unresolved-token` with nothing more. That failure now
  says which path names no token and what it was probably meant to be.
