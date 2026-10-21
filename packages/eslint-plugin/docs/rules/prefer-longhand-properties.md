# Discourage the use of shorthand properties and promote the preference for longhand properties in the codebase (`@bamboocss/prefer-longhand-properties`)

⚠️ This rule _warns_ in the 🌐 `all` config.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/use/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Reports a property written as its shorthand — `bg`, `p`, `pos` — and fixes it to the longhand: `background`, `padding`,
`position`. The two are one property to the build, so a fix changes nothing it emits. The opposite is
[`prefer-shorthand-properties`](./prefer-shorthand-properties.md); turn on one of them, since each undoes the other's
fixes.

Only a style's key is read, in a `css()`, `cva`, `sva` or pattern call. Not a recipe's variants — an axis declared under
`variants`, the argument a recipe is called with, `defaultVariants`, a compound variant's conditions — nor a property a
pattern declares, since the recipe or pattern reads those by name: a variant called `rounded` is not `borderRadius`. JSX
props are not read: with the JSX factory gone, an attribute is a component's prop, never a style.

## Examples

```ts
import { css } from '../styled-system/css'

css({ bg: 'red.100', p: '4' })
// is fixed to
css({ background: 'red.100', padding: '4' })

// `bg` here also reads a variable, which the fix keeps reading.
css({ bg })
// is fixed to
css({ background: bg })

// Reported, not fixed: two keys set `background`, and which one was meant is yours to say.
css({ bg: 'red.100', background: 'blue.100' })
```

## Options

<!-- begin auto-generated rule options list -->

| Name        | Type     |
| :---------- | :------- |
| `whitelist` | String[] |

<!-- end auto-generated rule options list -->
