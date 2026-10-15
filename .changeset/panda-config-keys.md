---
'@bamboocss/config': patch
'@bamboocss/generator': patch
---

Refuse the config keys Panda has and bamboo does not, instead of ignoring them. A config migrated from `panda.config.ts`
kept `strictTokens`, `polyfill`, `jsxFramework`, `jsxFactory`, `jsxStyleProps`, `syntax`, `studio`, a `jsx` entry in
`importMap`, or a pattern's `jsx`, `jsxName` and `jsxElement`, and built clean even under `validation: 'error'` — so
`strictTokens: true` enforced nothing, and nothing said so. Each now fails the build with the edit to make:
`strictTokens: true` is `strictValues: true`, and the others are deleted.

The generated `WithEscapeHatch` type no longer mentions `strictTokens`, and no longer links to `strictValues`, a build
check that does not touch it; the type is applied only under `strictPropertyValues`.
