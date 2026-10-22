# Enforce the exclusive use of design tokens as values for colors within the codebase (`@bamboocss/no-hardcoded-color`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

Reports a colour written out — `#ef4444`, `rgb(0, 0, 0)` — on a property that takes a colour token. A token passes:
`red.500`, a reference to one, `token(colors.red.500)`, or one with an opacity, `red.500/30`, unless `noOpacity` is set.

A value under `base` or a condition is read as a value of the property holding it, however deep it is nested:
`color: { base: …, _hover: … }`, `_dark: { color: { md: … } }`. A variant being chosen is not read — the argument a
recipe is called with, `defaultVariants`, a compound variant's conditions — since its value names a variant, even on an
axis called `color`. Nor is a computed key, which is whatever its expression holds.

## Examples

```ts
import { css } from '../styled-system/css'

// Reported.
css({ color: '#ef4444' })
// Reported: `#dc2626`, the value at `_hover`.
css({ color: { base: 'red.500', _hover: '#dc2626' } })

// Not reported: tokens, under any condition.
css({ color: { base: 'red.500', _hover: 'red.600/80' } })
```

## Options

<!-- begin auto-generated rule options list -->

| Name        | Type     |
| :---------- | :------- |
| `noOpacity` | Boolean  |
| `whitelist` | String[] |

<!-- end auto-generated rule options list -->
