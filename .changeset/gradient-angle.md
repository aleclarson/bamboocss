---
'@bamboocss/token-dictionary': patch
'@bamboocss/types': patch
---

A composite gradient token's numeric `placement`, which the docs allow, is an angle in degrees.

- `placement: 90` is `linear-gradient(90deg, …)`, and `conic-gradient(from 90deg, …)` for a conic gradient. It matched
  no composite gradient, so the token reached the stylesheet as an object.
- A semantic gradient written that way was read as a map of conditions named `type`, `placement` and `stops`, under an
  empty base value. It is one gradient, and one more for each condition it is given under.
- A radial gradient has no angle, and a number there is an error that says to place it with a shape and a position, like
  `'circle at top'`. So is a `placement` that is not a finite number.
