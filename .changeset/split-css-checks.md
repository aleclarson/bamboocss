---
'@bamboocss/generator': patch
'@bamboocss/core': patch
---

`cssgen --splitting` checks the sheet as `cssgen` does. Written layer by layer it skipped all three checks, so a token
that does not exist, a raw value under `strictValues` and a declaration the grammar rejects failed or were reported for
one file and shipped silently in the split one.
