---
'@bamboocss/shared': patch
'@bamboocss/core': patch
'@bamboocss/eslint-plugin': patch
---

Only a trailing `!` or `!important` marks a declaration important. Any `!` in a value used to count, and was cut out of
the value as it was marked:

- `content: '"!"'` came out as `content: "" !important`, and `content: '"hello!"'` as `content: "hello" !important`.
- `fontFamily: '"Foo!Bar", sans-serif'` lost its `!` and became important.
- `<!--` in an SVG data URI became `<--`, which broke the image.

A value whose `!` is part of it now keeps it, in the declaration and in its class name. Marks that end a value are all
removed, so `red !important !important` no longer emits a doubled, invalid mark, and a mark ending a `fallback(...)`
candidate still marks every candidate. The `no-important` lint rule now reads the keyword in any case, as the build
does.
