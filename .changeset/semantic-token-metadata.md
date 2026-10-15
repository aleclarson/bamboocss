---
'@bamboocss/token-dictionary': patch
---

Keep a semantic token's `description`, `deprecated` and `extensions` when its value is written as a string, a number or
a composite value. Wrapping the value as `{ base }` built a new token without them, so the description never reached the
spec, a deprecation never reached `isDeprecated` or the ESLint rule, and a plugin reading the extensions found none —
all of which a value written as a condition map kept.

- The token for each of a semantic token's conditions keeps `deprecated`, which cloning it dropped. So does a negative
  spacing token: `spacing.-4` is deprecated when `spacing.4` is.
- A theme variant's `description` and `deprecated` reach its tokens, and the theme spec.
- A token's `extensions` are copied rather than written into, so a frozen object no longer throws, and the dictionary
  sets the condition of a token it declares: an `extensions.condition` of the config's own changes nothing.
