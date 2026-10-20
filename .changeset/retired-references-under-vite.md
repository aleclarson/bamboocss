---
'@bamboocss/vite': patch
---

A style value holding the retired `token(path, fallback)` form, or a curly reference, fails the Vite compile in the
build's own words. `css({ color: 'token(colors.brand, #fff)' })` failed as a bare `css() — dynamic`, with advice to make
its values finite and statically analyzable, for a value written as a literal, while `bamboo cssgen` named the form and
what to write instead. The compiler's line for the call now says the same:
`` `token(colors.brand, #fff)` in the value `token(colors.brand, #fff)` uses the retired `token(path, fallback)` form. Write `token(colors.brand)` instead. ``

- The paragraph explaining code the compiler will not run follows only a call the evaluator refused, which it was
  written for. It followed any `dynamic` call with a reason, a `keyframes()` whose stops come from a parameter included.
