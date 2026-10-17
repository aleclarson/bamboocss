---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Read declarations as JavaScript runs them where 1.57.0 read another, and compiled to the wrong classes, dropped a
property or refused a call that runs.

- A barrel exporting a name itself is not given a star member's recipe of that name: with `export * from './recipes'`
  beside its own `export const button = …`, a call of its `button()` compiled to the recipe's classes.
- A module's `.js` is read over the declaration file beside it, which holds no value: `export const tone: string` in
  `tokens.d.ts` was read as `undefined`, and the property dropped, and a helper the `.js` exports, which its declaration
  file declares, was not called. A declaration file alone gives nothing.
- A function declared twice is the last of its declarations with a body, as JavaScript calls it, where the build called
  the first, and an overload's signature, which has none, gives way to the function it describes, exported or not.
- A `var` declared again with a value is written there, as an assignment is, in a component as in a module, and so is
  one a `for…in` or `for…of` head declares, which the loop assigns, and an exported helper declared again or assigned,
  called from another module: each was read as first declared, and the call fails the compile as `dynamic` now, naming
  the write. One declared only in a block, read outside it, may never have been assigned, and is not known.
- Past the number of calls, a refused recursion is named for the one branching furthest — the most calls a call — not a
  deeper one it was reached from, a small one each of its calls makes, or a helper that recurs not at all.
