---
'@bamboocss/generator': patch
---

A semantic token under one selector condition nested in another, outside a theme — `_dark: { _hc: … }`, or
`_pinkTheme: { _dark: … }` — holds where the second condition is on an element above the first's, as well as where both
are on one element. It was compounded onto the one element, `.dark.hc`, while a `css()` call nesting the same two
applies under `.hc .dark`, so a page with `.hc` above `.dark` styled its elements for both and kept the token's dark
value alone. This changes the token css of such a chain.

- A condition written as a list, `'[data-theme=dark] &, .dark &'`, meets the element the same way, rather than through a
  `:where()` compounded onto it, so the rule is as specific as the two conditions together, as a single one is.
- Inside the first condition's element it still does not hold: a condition set there, `.dark .hc`, would declare on a
  `.light` panel or the root of a region of the project's own, over the values that one has to keep. Theme variants meet
  a condition there too, as they already did.
