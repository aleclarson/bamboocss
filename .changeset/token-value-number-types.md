---
'@bamboocss/generator': patch
---

`token.value()` is typed `number` for a token holding a number. It returns one — `token.value('zIndex.modal')` is
`1400`, and the default preset's `zIndex` tokens are numbers — but was typed `string`, so passing it to a prop taking a
number failed to type-check, and a string method on it type-checked and threw. The generated `tokens.d.ts` lists those
paths as `NumericToken`, and `token.value()` returns `number` for one and `string` for any other.

- A path typed as `LiteralToken` as a whole may name either kind, and gets `string | number`. Code treating that value
  as a string fails to type-check now. Narrow the path to get `string`: ``Extract<LiteralToken, `colors.${string}`>``.
