# Discourage the use of longhand properties and promote the preference for shorthand properties in the codebase (`@bamboocss/prefer-shorthand-properties`)

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/use/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Reports a property written as its longhand where it has a shorthand — `background`, `padding`, `position` — and fixes it
to the shorthand: `bg`, `p`, `pos`. The two are one property to the build, so a fix changes nothing it emits. Of several
shorthands, the fix writes the shortest: `px` for `paddingInline`, `mx` for `marginInline`.

The opposite is [`prefer-longhand-properties`](./prefer-longhand-properties.md), and each undoes the other's fixes, so
turn on one of them. The `all` config turns on that one and not this.

Only a style's key is read, in a `css()`, `cva`, `sva` or pattern call. Not a recipe's variants — an axis declared under
`variants`, the argument a recipe is called with, `defaultVariants`, a compound variant's conditions — nor a property a
pattern declares, since the recipe or pattern reads those by name: a variant called `padding` is not `p`. JSX props are
not read: with the JSX factory gone, an attribute is a component's prop, never a style.

## Examples

```ts
import { css } from '../styled-system/css'

css({ background: 'red.100', paddingInline: '4' })
// is fixed to
css({ bg: 'red.100', px: '4' })

// `background` here also reads a variable, which the fix keeps reading.
css({ background })
// is fixed to
css({ bg: background })

// Reported, not fixed: two keys set `background`, and which one was meant is yours to say.
css({ background: 'red.100', bg: 'blue.100' })
```

## Options

<!-- begin auto-generated rule options list -->

| Name        | Type     |
| :---------- | :------- |
| `whitelist` | String[] |

<!-- end auto-generated rule options list -->
