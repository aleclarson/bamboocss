---
'@bamboocss/dev': minor
'@bamboocss/eslint-plugin': patch
---

Add `defineConditions`, the config helper for conditions Panda 2 added: `conditions: defineConditions({ … })`, typed as
a config's `conditions` are.

- `no-config-function-in-source` reports `defineConditions` in source files, and the other config helpers it did not
  know: `defineGlobalFontface`, `definePlugin`, `defineThemeVariant` and `defineThemeContract`.
