---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Evaluate `+` in style values the way the source does at runtime. Two numbers now add, so
`const base = 10; css({ zIndex: base + 1 })` compiles to `z-index: 11` instead of `101`, and `` `${2 + 3}px` `` to `5px`
instead of `23px`. A string operand still concatenates, as it does in JavaScript, so `'10' + 1` is still `101`, and
`null + 1` is `1` rather than `null1`.

The class and its rule always agreed with each other, so nothing reported it; both disagreed with the source.

An array converted to a string also writes a `null` or `undefined` element, and a hole, as nothing, as `join` does:
`` `${[1, null, 2]}` `` is `1,,2`, where it was `1,null,2`.
