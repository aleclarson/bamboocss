---
'@bamboocss/types': minor
'@bamboocss/generator': minor
---

Add `SystemStyleObjectWith` and `SystemStyleObjectWithout`, as Panda 2 has them: a style object with some properties
alone, or with every property but some, in every condition and selector too. For styles a caller may add to yours, typed
on the helper that returns them:
`(placement: SystemStyleObjectWith<'margin' | 'width'>) => ({ ...base, ...placement })`, whose result a call site passes
to `css()`. Either is a `SystemStyleObject`.
