---
'@bamboocss/preset-base': minor
---

Add the conditions Panda 2 added: `_pointerFine`, `_pointerCoarse` and `_pointerNone` for the primary pointer,
`_anyPointerFine`, `_anyPointerCoarse` and `_anyPointerNone` for any pointer, `_userValid` and `_userInvalid` for a
field validated once the user has interacted with it, and `_inert` for an inert subtree. Each also matches a `data-*`
attribute where it is a selector, as the other state conditions do.
