---
'@bamboocss/eslint-plugin': minor
---

`prefer-longhand-properties` and `prefer-shorthand-properties` fix what they report: `--fix` writes `bg` as
`background`, or the reverse, where they offered the rename only as an editor suggestion. The two spellings are one
property to the build, so a fix changes no class and no CSS.

- `{ bg }` is written out as `background: bg`, so it keeps reading the variable `bg`; the suggestion renamed it into
  reading one called `background`.
- A key is reported but not fixed where another key in the same object sets the same property, as in
  `{ bg: 'red.100', background: 'blue.100' }`: renamed, it would be a duplicate key, and which one was meant is the
  author's to say.
- Of several shorthands, `prefer-shorthand-properties` writes the shortest: `px` for `paddingInline`, which the config
  lists after `paddingX`. Its message named every shorthand in doubled backticks.
- Neither rule reports a key that is not a style any more: a recipe's variant (the argument it is called with,
  `defaultVariants`, a compound variant's conditions), a property a pattern declares, a computed key, a key being
  destructured, or a JSX attribute. `button({ rounded: true })` was reported as `borderRadius`.
- The `all` config no longer turns on `prefer-shorthand-properties`. It is the opposite of `prefer-longhand-properties`,
  and with both on, `--fix` would rename every such key back and forth; turn it on yourself if you prefer shorthands,
  and turn `prefer-longhand-properties` off.
