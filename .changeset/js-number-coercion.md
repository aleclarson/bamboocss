---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Read values in style expressions as JavaScript does, where the build used Rust's rules or guessed.

- A number written into a string uses an exponent where `String(number)` does: `` `${1e21}px` `` is `1e+21px` rather
  than twenty-two digits, `0.000001` stays `0.000001` rather than `1e-6`, `2 ** 60` is `1152921504606847000`, and `-0`
  is `0`.
- Bitwise operators wrap to 32 bits and take a shift count modulo 32: `(2 ** 32) | 0` is `0` rather than `2147483647`,
  and `-1 >>> 0` is `4294967295` rather than `-1`. A shift by 32 or more panicked in a debug build of the native
  extractor and took the process down with it.
- An array hole or `undefined` element read by index is no longer taken for `null`. The build holds all three as `null`,
  and they convert differently, so `[, 2][0] - 1` compiled to `z-index: -1` where the runtime has `NaN`; it now fails
  the compile as `dynamic`, as a template literal, a computed key or a destructuring or parameter default on one does,
  wherever it was kept: in an object, another array, `Object.assign`, a rest parameter. Where the two agree, a read of
  one still decides: `z[0] ?? 1`, `z[0] || 1` and `z[0] ? 1 : 2`. A `null` element is `null`, and an element the build
  cannot evaluate decides nothing.
- A choice decided by an element read with a number, `sizes[0] ?? 'md'`, now compiles, as `sizes['0']` did.
- A property written as `undefined` replaces what was there, as at runtime: `{ ...defaults, size: undefined }` kept the
  default, as did `Object.assign` and a spread of such an object, and `'size' in` it was false. `Object.assign` also
  keeps a source's undecided values, as a spread does, rather than reading them as missing.
- `join` writes a `null` element as nothing, as it does a hole: `[1, null, 2].join('-')` is `1--2`, not `1-null-2`.
- A property the prototype has is no longer read as `undefined`: `o.toString` and `[].map` are not known, and neither is
  `'toString' in o`. A string read by index gives its character, unless a space comes at or before it, which may have
  been any run of whitespace as the literal was written; for the same reason the length of a string holding a space is
  not known.
- An array index is read only in its canonical form, so `z['01']` and `z['+1']` are `undefined`, as they are at runtime,
  rather than `z[1]`; and `'length' in z` is true.
- Two strings compare as strings, so `'10' < '9'` is true, unless either holds whitespace, which the build collapses as
  it reads a literal. A string converts to a number only where JavaScript agrees: trimmed of its whitespace (U+FEFF, not
  U+0085) and never to `Infinity` from `'inf'`.
