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
  read-only, or bundled to CommonJS and exporting `presets` — is copied first, so it loads with them. Where the loader
  runs as an ES module, as under Vite with a config Vite loads as one (`"type": "module"`, or a `vite.config.mts`), such
  a config failed with a `TypeError`. As CommonJS, under the CLI and under Vite otherwise, the loader is not strict, and
  each default it could not write was dropped in silence: a config that cannot be extended, such as a frozen one, loaded
  without whichever of `outdir`, `validation` and the default presets, `@bamboocss/preset-base` and
  `@bamboocss/preset-bamboo`, it did not hold, as did one whose getter, or read-only inherited key, read as nothing for
  one of them, and what those generate changes now that they have the defaults. Any other kept what it held; only a
  preset it names by its package now maps to the copy the loader bundles. The copy holds every key the config has, its
  own and those it inherits, each as enumerable as it was, and reads each only when the copy's key is read, as the
  config would: a getter's value, or what a proxy's `get` answers for a key its `ownKeys` lists, which with no
  descriptor is a key `for…in` does not read and that hides none inherited; one only its `get` answers is not held. A
  key a class defines through a getter, such as `outdir`, is still left out where the merge reads keys with `for…in`, as
  it always was. Any other config is read, and written into, as it was. A `Proxy` refusing one of those writes, its trap
  returning false without taking it, now fails the load naming the key under either build, where CommonJS went on
  without it; one whose trap takes the write and returns nothing loads, where as an ES module it failed. A frozen token
  holding a `value` beside tokens nested in it still fails, as the merge writes a `DEFAULT` into it, with an error that
  does not name the token. A preset is not copied for this, so a hook is handed the object it exports.
- An ES module's default export, or a promise it exports, holding a `default` key beside keys of its own is kept whole,
  where 1.56.7 read it as that key; one holding nothing but `default`, or nothing but getters beside it, is read as its
  `default`, as it was. A CommonJS module's `default` is read, as it was, and so is that of a package compiled from an
  ES module, `__esModule` beside its `default`.
