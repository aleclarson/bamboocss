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
`nest(3)` compiles, up to 64 nested calls and 10,000 calls in all; past either, the whole call is refused. A refused
recursion gives nothing: none of the levels it went through reaches the stylesheet.

A helper called again through another module while it runs was already not followed; the error now says so, and names it
as it is declared, instead of reporting the call as dynamic with no reason, and as within a module none of the levels it
went through reaches the stylesheet. That holds through a barrel the helpers are imported from, re-exporting them by
name or with `export *`, and any reason a call was refused is no longer lost through an `export *` barrel.
