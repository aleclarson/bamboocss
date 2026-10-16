---
'@bamboocss/shared': patch
'@bamboocss/core': patch
'@bamboocss/eslint-plugin': patch
---

Read `! important`, with whitespace inside the mark, as an important mark. The browser treats `color: 'red ! important'`
as important either way, but the build wrote it as an ordinary declaration, so it was ordered and composed as something
it was not. It is now the same atom as `red !important`.

An escaped `\!` is not a mark either: `foo\!` is the identifier `foo!`, and `foo\!important` the identifier
`foo!important`. Stripping the `!` as a mark left a backslash, which escaped the space written after it.

The ESLint rule `no-important` names the mark it would remove, as it is written: the one the build reads, found where
the build finds it. `content: '"!important" !'` was reported as using `!important`, which is part of the string.
