---
'@bamboocss/config': patch
---

Report the error a config throws, and load ES module configs as Node would.

- An error while loading `bamboo.config.ts` used to be replaced by `Please pass in filename to use require`, after the
  config ran a second time. The real error is reported now, with the config's path, and the config runs once.
- A config is bundled as an ES module when Node would load it as one — `.mjs`/`.mts`, or `.js`/`.ts` under
  `"type": "module"` — so top-level `await` works. Everything it imports is still inlined, as before, so CommonJS
  packages load the same way under either format.
- `import.meta.url`, `import.meta.dirname` and `import.meta.filename` work in every config, as do `__dirname` and
  `__filename`, and each file a config imports sees its own. In a CommonJS bundle `import.meta` used to be empty, so
  `fileURLToPath(import.meta.url)` threw.
