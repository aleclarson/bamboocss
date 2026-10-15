# Prefer a token to a value written out that the token holds (`@bamboocss/prefer-token`)

⚠️ This rule _warns_ in the 🌐 `all` config.

💡 This rule is manually fixable by
[editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).

<!-- end auto-generated rule header -->

A value written out renders the same as the token holding it, and stops following the theme the day the token changes.
This rule reports a value a token of the property's category holds — `padding: '1rem'` where `spacing.4` is `1rem` — and
suggests the token, each one when several hold it. A value no token holds is nothing to report: the suggestion is always
a token.

The property is the one the value is for, however it is written: under a condition (`padding: { md: '1rem' }`), per
breakpoint (`padding: ['1rem']`), by its shorthand, or under a selector. A value is compared as CSS reads it: `#FFF`,
`#ffffff` and `#fff` are one color, and `.25rem` is `0.25rem`. Nothing else is case-folded — a keyframe's name, a custom
property's — and a quoted string or a `url()` is compared as written.

Not reported: a keyword or a name, such as `currentColor`, `auto` or `normal`, a value of CSS rather than a design value
written out; a value that already is a token's name; a recipe's variant selections — its call's argument, its
`defaultVariants` and a compound variant's conditions — which name variants, so a token in their place would select
none. JSX props are not read: with the JSX factory gone, an attribute is a component's prop, never a style.

## Examples

```ts
import { css } from '../styled-system/css'

// `1rem` is the `spacing` token `4`.
css({ padding: '1rem' })

// `700` is the `fontWeights` token `bold`, and `100%` the `sizes` token `full`.
css({ fontWeight: 700, width: '100%' })

// Fine: tokens, keywords, and values no token holds.
css({ padding: '4', fontWeight: 'bold', color: 'currentColor', margin: '0' })
```
