---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Refuse a style helper's recursion the build cannot see the end of, instead of crashing. A recursive helper called on a
value the build cannot read — `css(nest(props.depth))` — never reached its base case, and following it overflowed the
native stack: the process exited with a segfault, taking the dev server with it, and printed nothing.

A helper called again while it runs, with arguments the build cannot tell apart from those it is already running with —
`d - 1` is as unknown as `d` — is now refused at once, and the error names the helper and where it is: the first to run
of those that repeat, not one that recursed to reach them. A recursion whose arguments change is still followed, so
`nest(3)` compiles, up to 64 nested calls and 10,000 calls in all; past either, the whole call is refused, and the error
names the recursion: past the depth, the helper most of the calls running are of, not a small one each level calls, and
past the number of calls the one making the most of them, not a deeper one it was reached from or a small one each of
its calls makes. A refused recursion gives nothing: none of the levels it went through reaches the stylesheet.

A helper called again through another module while it runs was already not followed; the error now says so, and names it
as it is declared, instead of reporting the call as dynamic with no reason, and as within a module none of the levels it
went through reaches the stylesheet. That holds through a barrel the helpers are imported from, re-exporting them by
name, with `export *`, or importing them and exporting them again, and any reason a call was refused is no longer lost
through an `export *` barrel.

A helper a barrel exports by name is the one called, over one an `export *` there would give, as in JavaScript: the
build took the first in the barrel's order, so `export * from './base'` before `export { tone } from './custom'`
compiled `base`'s `tone`. An `export *` gives what JavaScript's does, for a helper or a value: nothing as `default`,
nothing through `export type *`, and only its name through `export * as legacy from './base'`, which the build read as
`export * from './base'`, compiling `base`'s `tone` over the one `custom` exports; written anywhere in the barrel, it
answers for its name before any `export *` does. A name a barrel declares itself — destructured, a class, a namespace or
an `export import` — is its own, where the build took a star member's, but not one TypeScript erases, `declare`d or a
function's overload signature: an exported function's overloads call the function they describe, where the build refused
them.
