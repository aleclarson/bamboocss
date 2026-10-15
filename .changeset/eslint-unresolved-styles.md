---
'@bamboocss/eslint-plugin': minor
'@bamboocss/node': patch
---

Add `no-unresolved-styles`, in `recommended`: the build's warnings about styles it could not read, reported where they
are written.

```ts
// `color` will not reach the stylesheet because its value could not be evaluated at build time.
export const tone = (color: string) => css({ color })
```

- The build's own extraction and the build's own words — what is lost and what to do — so it reports the styles the
  build drops and none it reads, not a guess at what is dynamic, as `no-dynamic-styling` makes. Each loss names its
  path, so several in one call can be told apart, and a recipe's says to set `className`, since a recipe the build
  cannot fully read loses every style rather than the one.
- No report for a file `include` does not reach, for one under `outdir`, for a processor's code block, or for a file the
  build reads rewritten — `.vue`, `.svelte`, `.astro`, or by a plugin's `parser:before` — whose positions are not the
  file's. A file with no bamboo import is not sent to the extractor at all.
- The editor's unsaved text is read for the file being linted only: another file importing it reads what is on disk.
- Every rule reads one context per config, prepared as the build prepares it, where the generator rules read their own:
  `include` is matched from the config's directory, so linting from a monorepo's root no longer reports
  `file-not-included` on every file of a project in it, and imports through the tsconfig's aliases count as bamboo's. A
  config the build cannot prepare — a tsconfig it cannot read — still answers the rules that read only the config, and
  one that fails to load, mid-edit, is loaded again once it changes rather than remembered as broken.
- Nothing the plugin's worker logs reaches ESLint's output, where a line corrupted `--format json`.
- `@bamboocss/node` exports `explainUnresolvedStyle`, the parts the build's warning is made of — the warning is
  unchanged — and makes `BambooContext.isGenerated` public.
