---
'@bamboocss/node': patch
---

A source file two links in `include` reach — a package linked twice, `src/shared` and `vendor/shared` — is extracted
once rather than once for each. The inventory still holds it under both, as the watcher and a bundler find it, and the
first of them is the one read: an atom sits at the rank of the earliest file that wrote it, so the stylesheet is as it
was.
