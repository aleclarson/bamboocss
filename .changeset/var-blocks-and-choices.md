---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Compile what 1.57.0 and 1.57.1 refused where the build knows the answer, and refuse what they compiled from a
declaration that had not run.

- A `var` declared in a block, read in that block after it, compiles again: 1.57.1 failed the build on
  `if (props.primary) { var tone = 'red.300'; return css({ color: tone }) }`, giving no reason, and on the same in a
  `switch` case, a `catch`, a callback in the block or a class `static` block. One a block of its own or a `for` head
  declares is read after it too. Read anywhere its block may not have run, it is still unknown.
- Called where its block may not have run, such a `var` is no longer called as if it had: `extra?.()` past an `if` that
  did not run compiled the function's classes, and so did a method walked from one, a key read from one, and one
  exported by name and called from another module. In a helper the build runs, one whose block ran is called. At a
  module's or a component's top level the build does not run the block, so a function an `if` — even `if (true)` — a
  `try`, a `switch` case or a labelled block declares, called after it, fails the compile as `dynamic` now, where 1.57.1
  compiled it as if the block always ran.
- An exported function declaration the module assigns to after, `tone = …`, fails the compile as a write, as within the
  module, where 1.57.1 compiled the function declared, from another module or through an `export *`.
- A choice spread before a method of the name, decided — `...(variant === 'ghost' ? { color } : {})` with `variant`
  passed or defaulted, `&&` on `false`, `??` on an object — is the branch it takes, as 1.56.7 compiled it, where 1.57.0
  and 1.57.1 failed the call. The branch not taken is not evaluated: `big ? heavy() : {}` failed for a recursion in
  `heavy`.
- An export read while a refused recursion unwinds, walked for a method, is no longer cached as unknown: every module
  reading it failed after, in a dev server until the export's own module changed.
- A declaration file comes after a directory's index as well: `lib.d.ts` beside `lib/index.ts` was read in its place,
  giving nothing.
