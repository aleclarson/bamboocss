---
'@bamboocss/config': patch
---

Keep the keys a config inherits through plain objects however far up, check what a config holds after every default the
loader writes, and load a preset in TypeScript named by its path.

- 1.57.0 walked a prototype chain a hundred levels up, against a proxy that makes one with no end, and cut a chain of
  plain objects short there too: a frozen config holding its `outdir`, `presets` or `include` further up lost them, and
  loaded with the default presets in place of its own, and a read-only key that far up failed the load, blaming a proxy
  the config does not have. Only proxies count against the limit now, a proxy with no traps among them.
- A `Proxy` refusing the `presets` the loader writes is read for the list it holds in its place, and one taking the
  write without storing it, as a read-only store does, is read the same way. `''`, as `CI && [...]` gives with `CI`
  empty, loaded with no presets, and `false` or `0` failed on a list, naming no key: anything but a list fails the load
  now, naming `presets`. A preset the list names that the loader bundles, `@bamboocss/preset-base` or
  `@bamboocss/dev/presets`, is that copy, as it is in the list written, where it was resolved from the project — a bare
  `Cannot find module` under pnpm. `outdir` fails the same way where no string is held; `validation` is read as `'warn'`
  wherever it is not.
- `presets: ['./my-preset']` beside a `my-preset.ts`, `'./my-preset.js'` naming it as an ES module in TypeScript does,
  or `'./presets'` for a `presets/index.ts`, failed to load in 1.57.0, as `require.resolve` tries no `.ts`. Each loads.
- Storybook runs the loader as it loads the module registering `@bamboocss/vite`: as an ES module from
  `.storybook/main.ts`, `main.js` or `main.mjs`, and as CommonJS from `main.cjs` or a CommonJS `vite.config`, which
  1.57.0's notes did not say.
