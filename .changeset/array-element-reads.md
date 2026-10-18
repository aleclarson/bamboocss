---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Read an element off an array with the choices it carries, and none of its siblings'. This changes the stylesheet: rules
only a sibling's choices gave are no longer written.

- An array held the values its elements could not decide between with no index, so a read of any one carried them all.
  `tones[0]` from `['red.300', c ? 'blue.300' : 'green.300']` wrote rules for `blue.300` and `green.300` as well, and
  `sizes[1]` beside an undecided `sizes[0]` wrote that one's rules too. A read of an undecided element writes its own
  values' rules, as before.
- A decided element read off such an array is known where it was refused: wrapped in an object and given to a rest
  parameter, placed in an array literal, or beside a sibling holding a key that is its index.
- The compiler follows a read at a literal index, `sizes[1]`, to the element the array literal places there, with no
  spread at or before it to move it, so a choice in a sibling no longer refuses it.
- An array handed on under another name — passed to a function, aliased, or with a method called on it, directly or
  through the object holding it — is read as before: every element carries all of the array's choices, and the compiler
  leaves its reads to the runtime. A `reverse()` or a write through the other name is not seen, so an index is no
  promise of which element it reads.
