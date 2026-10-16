---
'@bamboocss/config': patch
---

Report the error a config throws, and where in the source it threw, and bundle ES module configs as ES modules.

- An error while loading `bamboo.config.ts` used to be replaced by `Please pass in filename to use require`, after the
  config ran a second time. The real error is reported now, with the config's path and the file, line and column it was
  thrown from, read back through the bundle's source map. The config runs once.
- A config is bundled as an ES module when its extension or `package.json` says it is one — `.mjs`/`.mts`, or
  `.js`/`.ts` under `"type": "module"` — so top-level `await` works there. Its syntax is not read: a `.ts` file using
  `import` with no `"type": "module"` is still bundled as CommonJS, where top-level `await` is not available. Everything
  a config imports is still inlined into the bundle, under either format.
- An ES module config is imported from a temporary copy in the nearest `node_modules/.bamboo` (or the system's temporary
  directory where there is no `node_modules`), and the copy is removed once the config has loaded. One left behind by a
  process that was stopped mid-load is removed by a later load once it is an hour old. `require` and `require.resolve`
  in the bundle resolve from the config, as they do in a CommonJS one. Two things resolve from the copy instead: an
  `import()` whose specifier esbuild cannot read, and `import.meta.resolve`.
- `import.meta.url`, `import.meta.dirname` and `import.meta.filename` work in every config, as do `__dirname` and
  `__filename`, and each file a config imports sees its own. In a CommonJS bundle `import.meta` used to be empty, so
  `fileURLToPath(import.meta.url)` threw.
- A config exporting `null` is reported as one that does not export an object.
