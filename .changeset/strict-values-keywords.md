---
'@bamboocss/core': patch
'@bamboocss/generator': patch
---

`strictValues` takes keywords side by side or listed, as it takes one, and reports each raw value once.

- `objectPosition: 'center top'` and `transitionProperty: 'opacity, transform'` were raw css for their spaces and
  commas, though no keyword can be written without them, and under `validation: 'error'` they failed the build. A list
  the property does not take — a keyword misspelled, or token names side by side, which are not resolved — is raw as it
  was.
- Under `warn`, a raw value is reported once. A client and a server build emit the stylesheet each, and a dev server on
  every edit, and each repeated the whole list. A value written later is reported as one more, of all there are.
  `validation: 'error'` still fails each build that holds one.
