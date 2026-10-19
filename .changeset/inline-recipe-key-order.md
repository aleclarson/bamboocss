---
'@bamboocss/core': patch
---

Two inline recipes that differ only in key order no longer fail the build. A `cva` or `sva` writing the same variants in
another order, or the values of one variant in another order, is named the same as the first, since the name is derived
with keys sorted, and registering it compared the configs key order and all: the build failed with
`could not be extracted` over two valid programs. Each call's classes still come from its own config, so where two
variants set the same property, the one declared later in that call's config still wins. A different recipe under one
declared `className` is still a conflict.
