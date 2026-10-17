---
'@bamboocss/config': patch
'@bamboocss/types': patch
---

Report the error a config throws, and where in its source the error came from, and bundle ES module configs as ES
modules.

- An error while loading `bamboo.config.ts` used to be replaced by `Please pass in filename to use require`, after the
  config ran a second time. The real error is reported now, with the config's path, and the config runs once. Where its
  stack says the error was created is read back through the bundle's source map to a file, line and column, and when
  that is inside an installed package, so is the first place outside every installed package: the config's own code, or
  a file it imports.
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
- A config, or a preset, that is something other than an object — a function, `null`, `undefined`, or a default export
  that is `undefined` — is reported as not being one, a preset named by its package by its name. In 1.56.7 a function
  preset was merged as one holding nothing, `null` and `undefined` presets failed with a `TypeError` naming no preset,
  and a config whose default export was `null` or `undefined` loaded as an empty one. What a `preset:resolved` hook
  returns is checked too, unless it is nothing, or `false`, which leaves the preset out as it did.
- A preset that is `false` — written so, a promise of it, or the default export of a module named in `presets` or
  written there as `import()` — is left out before any `preset:resolved` hook runs, and is not in the resolved
  `presets`. 1.56.7 handed it to the hooks as the preset, which their type does not allow, and kept it in the list. A
  preset a hook leaves out is handed to no later plugin's hook either, nor kept in the resolved `presets`, where 1.56.7
  handed that one `false` and kept it. Whatever else a hook returns that is not an object is refused as it is returned,
  rather than handed to the next.
- What a promise a config or a preset exports rejects with is reported as the module's error, with its location. A
  module written in `presets`, `import('./preset')`, is read as the module, as one a config exports is.
- A config the loader cannot write its defaults into — frozen, holding a key it writes as a getter, or inheriting one
  read-only — or the exports of a config bundled to CommonJS, is copied first, so it loads: it failed with a
  `TypeError`. The copy holds every key the config has, its own and those it inherits, each as enumerable as it was, and
  reads a getter when the copy's key is read. Any other config is read, and written into, as it was; a `Proxy` refusing
  a write still fails, and so does a config whose token objects are frozen, which the merge writes into. A preset is not
  copied for this, so a hook is handed the object it exports.
- An ES module's default export, or a promise it exports, holding a `default` key beside keys of its own is kept whole,
  where 1.56.7 read it as that key; one holding nothing but `default`, or nothing but getters beside it, is read as its
  `default`, as it was. A CommonJS module's `default` is read, as it was, and so is that of a package compiled from an
  ES module, `__esModule` beside its `default`.
