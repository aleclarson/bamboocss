---
'@bamboocss/token-dictionary': patch
'@bamboocss/types': patch
---

A gradient token's numeric stop `position` is a percentage along the gradient, as in Panda 2: `position: 100` is its
end, `100%`, where it was `100px` — a hundred pixels in, the rest filled with the last color, on anything wider. This
changes the css of a composite gradient token that places its stops with numbers.

- A string `position` is written as it is, so a stop meant in pixels is `position: '100px'`.
