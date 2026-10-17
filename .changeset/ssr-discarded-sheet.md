---
'@bamboocss/vite': patch
---

A stylesheet in an environment whose assets Vite discards — SSR's, unless `ssrEmitAssets` is set — is no longer pruned,
so what pruning it would have removed is no longer taken for lost. A watch rebuild of such an environment that started
using a class its first build did not failed with "already pruned out of a stylesheet", naming a class no written sheet
had ever been without, and so did an SSR rebuild after a client-only edit in a run that announces its environments.

The error that guard raises now says the classes are in use as an environment finishes, rather than compiled in it, and
names a rebuild of every environment at once in a watch among its causes.
