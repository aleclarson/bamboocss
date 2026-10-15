# Report styles the build cannot read, whose declarations never reach the stylesheet (`@bamboocss/no-unresolved-styles`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

The build warns when it cannot read a style: a value known only at runtime, an object spread it cannot see into. The
declarations it could not read have no rule behind them, so they are absent from the page. This rule reports the same
warnings where they are written, from the build's own extraction and in the build's own words — not a guess at what is
dynamic, as [`no-dynamic-styling`](./no-dynamic-styling.md) makes — so it reports exactly the styles the build drops.

No report for a file the config's `include` does not reach, which the build never reads; for one under `outdir`, which
the build does not warn about either; for a code block a processor such as `@eslint/markdown` lifts out of a document;
or for a file the build reads rewritten — a `.vue`, `.svelte` or `.astro` file, or one a plugin's `parser:before`
changes — whose positions are not the file's. A file that reaches bamboo only through `require()` or a re-export is not
checked. The editor's unsaved text is what is read, and only for the file being linted: another file importing it reads
what is on disk, as the build does.

## Examples

```ts
import { css, cva } from '../styled-system/css'

// `color` will not reach the stylesheet because its value could not be evaluated at build time.
export const tone = (color: string) => css({ color })

// An object spread or computed key leaves the build unable to tell which properties this call sets.
export const passthrough = (props: object) => css({ ...props })

// A recipe loses every style, not this one: its class names are named from what the build read.
export const card = (color: string) => cva({ base: { color } })
```

Write the value out, use a recipe variant for a known set of values, or generate a genuinely dynamic one with
`staticCss`. See [dynamic styling](https://bamboocss.com/docs/guides/dynamic-styling).
