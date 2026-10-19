---
'@bamboocss/types': minor
'@bamboocss/generator': minor
---

Add `SystemStyleObjectWith` and `SystemStyleObjectWithout`, as Panda 2 has them: a style object with some properties
alone, or with every property but some, in every condition and selector too. For a component that lets its caller style
part of it: `css?: SystemStyleObjectWith<'margin' | 'width'>`. Either is a `SystemStyleObject`.
