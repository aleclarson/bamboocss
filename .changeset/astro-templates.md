---
'@bamboocss/node': patch
---

A `.astro` file is read with the compiler Astro 7 depends on, and two shapes of template that failed the whole file
under Astro 6's are read.

- Astro 7 depends on `@astrojs/compiler-rs` rather than `@astrojs/compiler`. With no `@astrojs/compiler` installed,
  every `.astro` file was read as empty, without a word, and none of its classes had a rule. `@astrojs/compiler-rs`
  reads the component now, as Astro's own build does, and `@astrojs/compiler` reads what it cannot, since Astro 6 takes
  some templates Astro 7 does not. With neither, Bamboo says so, and says why one that is installed failed to load.
- With `@astrojs/compiler`, a regex holding a `}`, a `{`, a backtick or a quote in a template expression,
  `{x.replace(/}/g, '')}`, ended the expression there. Several nodes side by side in an expression,
  `{cond && ( <a /> <b /> )}`, which Astro allows, were each put in a fragment of their own. Either way the file did not
  parse, and none of it was extracted. Such a component is converted again, with the regex's characters written as
  escapes that match the same ones and the nodes in one fragment. One that converts today is converted as it was: across
  1,615 components, the 4 that change are the 4 that failed.
