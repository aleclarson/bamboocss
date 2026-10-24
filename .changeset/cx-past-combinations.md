---
'@bamboocss/vite': patch
---

A `cx()` with four or five conditions now resolves a property the way one with fewer does: the later argument wins.

The compiler writes out every combination of a call's answers, and it used to stop at eight — three conditions. A call
with more stayed the runtime join, and a join does not merge: where two arguments set the same property, the element
carried both classes and the browser applied whichever rule the stylesheet held later. That follows where a style was
declared, not where the call passed it, so `cx(base, !active && muted, …)` with four conditions rendered an inactive
button in `base`'s color whenever `muted` was declared above `base`.

The limit is now thirty-two combinations, five conditions. Each combination is still written out whole, so a call's
output doubles with each condition; one past five stays the runtime join, and is better written as a recipe.
