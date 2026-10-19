---
'@bamboocss/node': patch
'@bamboocss/dev': patch
---

`--watch` follows what the config is built from as it changes. `codegen`, `cssgen` and `ship` watched the files the
config imported when the watch started, so after an edit that swapped in a preset or imported one more module, editing
that file did nothing until the process restarted. The watch now re-arms on what each reloaded config imports, also when
the reload resolves to the same config, as moving tokens into an imported module does, and when it fails to load, so
fixing the module that broke it reloads. The Vite dev server was not affected: it restarts when the config changes.
