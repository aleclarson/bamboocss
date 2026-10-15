---
'@bamboocss/eslint-plugin': minor
---

Add `prefer-token`, in `all`: a value written out that a token of the property's category holds — `padding: '1rem'`
where `spacing.4` is `1rem` — with the token as the suggestion, each one when several hold it.

- Only a value a token holds is reported, so the suggestion is always a token: a value no token holds — `0` — is nothing
  to report, and neither is a keyword or a name such as `currentColor` or `normal`, nor a value that already is a
  token's name.
- The property is the one the value is for, however it is written: under a condition, per breakpoint, by its shorthand,
  or under a selector. A recipe's variant selections — its call's argument, `defaultVariants`, a compound variant's
  conditions — are left alone, since they name variants.
- A value is compared as CSS reads it: `#FFF` and `#ffffff` are `#fff`, and `.25rem` is `0.25rem`. A keyframe's or a
  custom property's name keeps its case.
