---
'@bamboocss/generator': patch
'@bamboocss/types': patch
---

What source code hands Bamboo takes `undefined` for each key it may leave out, as a project with
`exactOptionalPropertyTypes` writes one when it passes a value on or leaves it out.

- Under that option `?:` alone does not take it, so a condition block written `_hover: active ? { … } : undefined`, a
  utility with no css property behind it (`colorPalette`, `srOnly`, `truncate`, `boxSize`), a pattern's own props
  (`grid({ columns })`, `divider({ orientation })`), a recipe's `base`, `variants` or `defaultVariants`, and a slot
  recipe's record for any one slot were each rejected. So were a view transition's parts, and a recipe config's
  `description`, `jsx` and `staticCss`.
- The rest of a config's own types, such as a pattern's config or `staticCss`, are as they were.
- Types only: no css a project emits changes.
