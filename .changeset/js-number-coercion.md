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
  object read where a spread it could not read may have written over it may be another object.
- A value after a comma whose left side the build cannot evaluate, `(track(), styles)`, may have been changed by it, so
  nothing is read from the value either. `'z' in { ...(track(), s) }` was answered from `s` as declared, and a property
  read from such a value, or a rest pattern's object taken from it, compiled.
- `Object.assign` onto `null` or `undefined` throws, and is no longer read as an object: a rule was written for what the
  call never returns. Nor is one onto one of several values, which may be either, `p.x ? null : undefined` included.
- A call is given the elements of an array it spreads where the build knows how many there are, each as it knows it. A
  spread of an unknown length was read as one argument, so a parameter after it was given what was written one place on,
  or `undefined`, and a default stood in for it: now a parameter after such a spread is not known, however far after it.
  `Object.assign` still writes the sources after one.
- An element of a rest parameter holding a value the call could not decide between is not known as a whole, where it was
  read without what it could be: `(...xs) => xs[0]` given `{ color: c ? 'a' : 'b' }` compiled with no color. What is
  known of it still is — its other keys, and that it holds `color` — and so are the rest's other elements and how many
  there are. An `undefined` it is given is held as one, as an array literal holds it: `(...ys) => ys.join('-')` given
  `undefined` and `'4'` compiles to `-4`, where the call failed the compile.
- `css.raw` of more than one style object was read as the first of them, so `css()` of it compiled without the others.
  Extraction now writes the rules of each, and such a `css()` fails the compile as `dynamic`. What `css.raw` leaves out
  at runtime — `undefined`, `null`, `false`, an object with nothing defined in it — is left out, so
  `css.raw(style, undefined)` is still read as `style`; and `css.raw` of an array, which throws, is not known, where the
  compile itself failed on it.
- An enum with a member the build cannot evaluate is still known by its other members: `E.A` beside `B = compute()`
  compiles, and so does `'A' in` it. An enum exported from another module is read as one in the module itself is. A
  numeric enum is known member by member and not as a whole: the reverse mapping from a value to its member's name is
  not held, so a read through it, `Area[Area.main]`, is not known, where it dropped the property. Which keys it has is
  known, the mapping's among them, which `in` took for absent: `'1' in E` is true, and `'B' in E` false. An enum
  declared again with members of its own, another enum, is not known, where it was read as its first declaration, so a
  member the other added was dropped. Merged with a namespace holding values it is known by its own members, and not by
  the names the namespace exports, as it is merged with a `declare`d one; a namespace of types alone changes nothing,
  declared before the enum or after it.
- A parameter's or a destructuring default no longer stands in for an argument that is one of several values:
  `(x = 'green.300') => x` given `c ? 'red.300' : 'blue.300'` compiled to green, which the call never gives. As one of
  them may be `undefined`, which a choice keeps no branch for, extraction writes the default's rules beside them where
  the default is a literal, or an array or object of literals: one that reads a binding or calls anything is not run for
  this, as what it runs could cut the whole call short.
- An array element holding values the build could not decide between is not known as a whole read by index, where it was
  read as what it holds without them: `(sizes) => sizes[0]` given `[{ color: c ? 'a' : 'b' }]` compiled with no color.
  What is known of it still is, as of a rest parameter's element. One read where any element, that one included, holds a
  value the build could not decide between under a key that is its index is not known at all, as what the array holds
  under that key may be another element's.
- An element read past the end of an array, or a key an object read off one surely lacks, is `undefined` whatever its
  siblings could be: `(xs) => xs[2] ?? '7'` given `[c ? '1' : '2', '4']` failed the compile as `dynamic`.
- Converting an array holding an element the build could not decide between — `join`, `+`, a template literal — is not
  known, where 1.56.7 wrote that element as `null`: `[c ? 'a' : 'b', 'x'].join('-')` compiled to `null-x`.
- `==` converts its operands as JavaScript does — `'0' == 0` is true — and `===` of two objects or arrays is not known,
  as they are the same only as one object: both compared what the values hold, so `n == 0` given `'0'` was false and
  `[1] === [1]` true. Two numbers are compared as numbers, where how each was held was compared too: a length or a
  bitwise result never equalled a literal, so `xs.length === 2 ? a : b` compiled to `b`. Two strings are known to be the
  same only where they hold no whitespace, which the build collapses as it reads a literal, and to differ wherever they
  still do once each run of it is one space: `'a  b' === 'a b'` was true, and `'a ' + ' b' === 'a  b'` false.
- A computed key and the left of `in` are converted as any value is, so one the build could not wholly read is not
  known, where it read what that value converted to: `sizes[[c ? 'lg' : 'sm', 'x'].join('-')]` was `sizes['null-x']`, a
  known `undefined`.
- `fallback()` of a value the build cannot evaluate is not known: it was read as `undefined`, so
  `css({ height: fallback(p.h, '100vh') })` compiled with no height. It writes `null` and `undefined` as nothing, as the
  runtime's `join` does, where `undefined` dropped the property and `null` was written as `null`.
- A choice is no longer made on a value the build only guessed: a property a spread it could not evaluate may have
  written over, as in `const options = { dense: false, ...props }`, or anything worked out from one.
  `options.dense ? '2' : '4'` compiled to `p_4` whatever the caller passed; the call fails the compile as `dynamic` now.
  The same holds for `||`, `??`, `&&`, `!`, `?.` and an `if`, and unary `+`, `-`, `~` and `typeof` of such a value are
  guesses too. A spread the build evaluated that writes nothing — `undefined`, `null`, `false` — or one of several
  objects whose keys it can read off the source, `...(c ? { size } : {})`, leaves every other key as known as it was.
  The object holding such a spread is known as a whole once each key a branch of it writes is written again,
  `{ ...(c ? { color: 'blue.300' } : null), color: 'red.300' }`, which 1.56.7 failed as `dynamic`. An object or array is
  truthy however much of it is known, and not `null`, but not one read where a spread may have written over it, which
  may be `null` there.
- `token()` of a path the build only guessed, or could not wholly read, is not known: built from a default a spread may
  write over, ``token(`colors.${o.tone}.300`)`` compiled to the default's variable whatever the caller passed, and a
  path joined from a part not decided, `token(['colors', c, '500'].join('.'))`, to none.
- A method of an object is not taken from a property a later spread may write over: `options.color()` of
  `{ color: () => 'red.300', ...props }` compiled to red whatever `props` held. The last property of its name is the one
  called, one a key computed to the name writes included, where 1.56.7 called the first of
  `{ color: …, [KEYS.color]: … }`; one before a spread is called where the spread surely writes no such name — a
  literal, an import or what a call returns that holds none, `null`, a binding declared without a value — and before a
  key the build computes to another name, `[KEYS.size]`, ``[`size`]``, `[1]`. Past a spread or a key it cannot read, the
  call fails the compile as `dynamic`, where 1.56.7 called the method before it.
- A module's `var` declared again with a value is written there, as an assignment is: `var tone = a; var tone = b` was
  read as `a`, whether as a value, called or holding a method, and the call fails the compile as `dynamic` now — naming
  the write where `tone` is read or called. A function's body still reads such a `var` in the order it runs, but a
  helper or a method one holds is not called there, where the one declared first was.
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
