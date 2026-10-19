---
'@bamboocss/core': minor
'@bamboocss/generator': minor
'@bamboocss/node': minor
'@bamboocss/reporter': patch
'@bamboocss/types': minor
'@bamboocss/vite': minor
---

Add `keyframes()`, which Panda 2 added: write a `@keyframes` block where it is used and get its name back to animate
with. Imported from `styled-system/css`. See the new Keyframes page.

```ts
const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })

css({ animation: `${fadeIn} 0.2s ease-out` })
```

- The name is a hash of the stops, `kf_feVUdh`, so the same stops anywhere in the project are one block. It hashes them
  in the order they were written, as a stop written twice, `from` and `0%`, is resolved by which comes later. The class
  `prefix` goes first, `app-kf_feVUdh`.
- The compiler replaces the call with the name, which is computed once and written on the block, so a style object
  reading the call, in the same module or through an import, animates the block the stylesheet holds. Stops it cannot
  read whole fail the build, and are reported in the editor by `no-unresolved-styles`.
- A stop's declarations resolve as in `css()`, tokens included, and the block lands in the `tokens` layer beside the
  theme keyframes. It is written while the call exists, whether or not the stylesheet names it, since an inline `style`
  can.
