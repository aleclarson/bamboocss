---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Convert values in style expressions as JavaScript does, where the build used Rust's rules or guessed.

- A number written into a string uses an exponent where `String(number)` does: `` `${1e21}px` `` is `1e+21px` rather
  than twenty-two digits, `0.000001` stays `0.000001` rather than `1e-6`, `2 ** 60` is `1152921504606847000`, and `-0`
  is `0`.
- Bitwise operators wrap to 32 bits and take a shift count modulo 32: `(2 ** 32) | 0` is `0` rather than `2147483647`,
  and `-1 >>> 0` is `4294967295` rather than `-1`. A shift by 32 or more panicked in a debug build of the native
  extractor and took the process down with it.
- An array element that is a hole, `undefined` or `null` is no longer read by index as `null`: the build holds all three
  as one, and they convert differently, so `[, 2][0] - 1` compiled to `z-index: -1` where the runtime has `NaN`. Such a
  read now fails the compile as `dynamic`, and extraction leaves it out.
- An array index is read only in its canonical form, so `z['01']` and `z['+1']` are `undefined`, as they are at runtime,
  rather than `z[1]`; and `'length' in z` is true.
- Two strings compare as strings, so `'10' < '9'` is true, and a string converts to a number only where JavaScript
  agrees: trimmed of its whitespace (U+FEFF, not U+0085) and never to `Infinity` from `'inf'`.
