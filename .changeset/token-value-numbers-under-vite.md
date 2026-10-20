---
'@bamboocss/vite': patch
---

A `token.value()` of a number compiles under Vite, to the number. Standing alone it failed the build as
`token() — unresolved-token`, a token that exists, because the compiler wrote string literals only. The default preset's
`zIndex` tokens are numbers, so `<Dialog zIndex={token.value('zIndex.modal')} />` could not be built. Now
`token.value('zIndex.modal')` compiles to `1400` and `token.value('zIndex.hide')` to `(-1)`, the numbers the runtime
returns. A negative one is parenthesized, so a method called on it or a `**` after it reads as it did.
