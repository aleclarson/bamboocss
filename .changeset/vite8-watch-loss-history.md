---
'@bamboocss/vite': patch
---

On Vite 8, a watching build no longer reports a class a client rebuild restored as already pruned out of a stylesheet.
Rolldown hands a watch build one output-options object generation after generation, and the record of what a sheet had
pruned was found by it, so a class the first sheet pruned and the next restored stayed lost: an SSR rebuild that
compiled it, of unchanged source included, failed naming it.
