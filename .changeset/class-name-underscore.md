---
'@bamboocss/core': patch
'@bamboocss/shared': patch
---

A literal underscore in a style value or a selector condition is spelled `\_` in its class name, as Tailwind spells one
in an arbitrary value. A class name spells a space `_`, so `fontFamily: 'My Font'` and `fontFamily: 'My_Font'` were both
`ff_My_Font`: one class carrying both declarations, the later winning on every element that asked for either. Hashed
names collided the same way, since a hashed name is a hash of the readable one. They are now `ff_My_Font` and
`ff_My\_Font`.

A backslash is doubled only before a space, an underscore or another backslash, where it could be read as the start of
`\_`. A CSS escape such as `var(--spacing-0\.5)` or `content: "\f101"` keeps its name, and no class in the documentation
site's stylesheet or the css-in-js benchmark lane's is renamed.
