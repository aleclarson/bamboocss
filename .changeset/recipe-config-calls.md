---
'@bamboocss/vite': patch
---

Compile a `token()` call written inside a `cva` or `sva` config, `cva({ base: { color: token('colors.red.300') } })`. It
was rewritten in place before the declaration around it was erased, and the two edits collided, so the declaration
stayed and the build failed reporting the `cva` import as `runtime-binding` at it. The call now goes with the
declaration, since the stylesheet has already read its value out of the config. The same holds for `keyframes()`.
