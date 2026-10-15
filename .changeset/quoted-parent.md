---
'@bamboocss/core': patch
'@bamboocss/generator': patch
---

An `&` or a comma inside a quoted attribute value in a selector is the value's own character.

- Every `&` was taken for the parent, so `'&[data-label="a & b"]'` had the element's class written into the value it
  matches against, and a comma split the selector in two at `'&[data-label="x,y"]'`. Each such rule matched nothing. The
  same held for a theme or a condition such as `'[data-a="a &"] &'`, for the tokens written under it and for a reset's
  scope.
- A key whose only `&` is quoted names no parent, and nests as a descendant, as a key with no `&` does.
- The parent is written as it is: `String.replace` read a `$&` or `$$` in it as a pattern. And a class ending in an
  escaped `&` keeps it before a descendant: the first `& ` in the selector was dropped wherever it stood.
- A selector that quotes and escapes nothing — nearly every one — is read without walking it, and is no slower:
  2.58–2.60 → 2.17–2.20 µs a rule, measured side by side.
