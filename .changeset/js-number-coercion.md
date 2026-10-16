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
  default, as did `Object.assign`, a spread of such an object and a JSX attribute `size={undefined}` after a spread, and
  `'size' in` it was false. Any later write of a key drops the values an earlier one could not decide between, which
  extraction used to write rules for, and keys removed leave the rest in the order they were written. `Object.assign`
  also keeps a source's undecided values, as a spread does, rather than reading them as missing, and `in` is known for
  an object whose keys are known though a value is not.
- A key a spread writes with a value it could not decide between, or could not evaluate, keeps nothing of what was
  there: `{ a: 'p', ...{ a: c ? '' : 'y' } }` was read as `'p'`, so a choice on it wrote one arm's rules. The same holds
  for a JSX attribute after a spread, and a key written after a spread the build could not choose a branch of replaces
  it in every branch. `__proto__: base` in an object literal sets the prototype, so the object is no longer read as
  holding only its own keys — `css()` walks inherited ones too — though a key it holds is still read as written, and
  `__proto__: null`, or another value surely not an object, sets none. A rest pattern that takes a key the build cannot
  name leaves the rest unknown rather than holding every key.
- `'a' in` an object decides a choice wherever `a` is surely there: held with a value the build could evaluate, or
  written with one of several values after any spread the build could not read, as in `{ ...props, a: c ? 1 : 2 }`.
  Where `a` may not be there it is unknown: a branch of a spread the build could not choose may hold it or not, and an
  object read where such a spread may have written over it may be another object.
- A value after a comma whose left side the build cannot evaluate, `(track(), styles)`, may have been changed by it, so
  nothing is read from the value either. `'z' in { ...(track(), s) }` was answered from `s` as declared, and a property
  read from such a value, or a rest pattern's object taken from it, compiled.
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
