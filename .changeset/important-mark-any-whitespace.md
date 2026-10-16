---
'@bamboocss/shared': patch
'@bamboocss/core': patch
'@bamboocss/vite': patch
'@bamboocss/eslint-plugin': patch
---

Read an important mark the way the stylesheet ends up holding it.

- Any whitespace inside a mark counts, not only CSS's: the build writes each run of it as one space, so `!` and
  `important` with a no-break space between them reach the browser as an important declaration. Read as no mark, a value
  from the config — which reaches the class name sanitized and the stylesheet as written — named a class for an ordinary
  rule while the rule was written as an important one, and the element matched nothing. The class is now named from the
  same value the mark is read from. NUL beside the mark, which the build removes from a value, counts as whitespace too.
- A comment is whitespace too, after the mark or inside it: `red !important /* c */` is important, as it is to the
  browser, and was written into an ordinary sublayer. Comments are read as CSS reads them, not nested, where nothing in
  the value can hide one from its tokenizer: in a value holding a string, an escape or an unquoted `url()`, a comment is
  left as written, as before.
- An escape hatch is only brackets that are the whole value: `[a] 1fr [b!]` is two line names around a track, and its
  `!` is no mark. A fallback candidate that is an escape hatch holding the mark, `fallback([a!], b)`, marks the
  declaration, as `[a!]` alone does.
- `no-important` reads a template literal as it cooks, as the build does, so `` `red\!` `` is reported and
  `` `foo\\!` `` is not. Its suggested fix is written back escaped the way the literal reads: `"\"hi\" !"` became
  `""hi""`, which does not parse, and `'a\\! !'` became `'a\!'`, a mark again. A carriage return in a template, a
  control character and half a surrogate pair are written back as escapes.
