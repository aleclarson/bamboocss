---
'@bamboocss/vite': patch
'@bamboocss/node': patch
---

`token(path) ?? '#fff'` compiles under Vite. It is how the docs say to write a path that may name no token, now the
fallback argument is retired, and the Vite compiler refused it: in a style whatever the token, as a `dynamic` call,
since it did not accept a choice decided by a call, and standing alone where the path named none, as `unresolved-token`.
A `token()` or `token.value()` call is a lookup in the table the build holds, so a choice is now decided by what it
returns, as `bamboo cssgen` already did: `css({ color: token('colors.brand') ?? '#fff' })` compiles to `color: #fff`
where `colors.brand` names no token, and to its variable where it does.

- A call naming no token whose result is tested or defaulted — the left of `??`, `||` or `&&`, a condition, the operand
  of `!` or `typeof`, a side of an equality — compiles to the `undefined` it returns, standing alone as well. One whose
  result is used as it is still fails, with the path it was probably meant to be.
- A `token.value()` of a number inside a style failed the compile as `unresolved-token` though the style compiled around
  it, `css({ zIndex: token.value('zIndex.modal') })`. It goes with the style now. Standing alone it still has no string
  literal to stand in for it, and still fails.
