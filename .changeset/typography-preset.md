---
'@bamboocss/preset-bamboo': minor
'@bamboocss/dev': minor
---

Add `typographyPreset()`, an opt-in `prose` recipe for Markdown and CMS HTML, ported from Panda's typography preset.
List it after the default presets: `presets: [...defaultPresets, typographyPreset()]`, both from
`@bamboocss/dev/presets`. Nothing changes unless it is listed and `prose()` is called.

- Five sizes, each one font size on the root with everything inside a ratio of it, and colors from `prose.*` semantic
  tokens built on the `neutral` palette, light and dark.
- Each element is styled under a key of its own, so `cx(prose(), css({ '& h2': … }))` overrides that heading alone.
- Every value outside the theme is written as `[value]`, so it builds under `strictValues`.
- With `notProse`, the rule for the first child keeps its combinator outside `:where()`, where Panda's matched nothing.
- `sizes.prose` stays 65 characters.
