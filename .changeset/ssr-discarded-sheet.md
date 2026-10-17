---
'@bamboocss/vite': patch
---

What pruning a stylesheet removes in an environment whose assets Vite discards — SSR's, unless `ssrEmitAssets` is set —
is no longer taken for lost: the sheet is never written. It is still pruned and renamed, as its name is how a server
bundle links the client's sheet. A watch rebuild of such an environment that started using a class its first build did
not failed with "already pruned out of a stylesheet", naming a class no written sheet had ever been without, and so did
an SSR rebuild after a client-only edit in a run that announces its environments, where the environment completing the
run had also taken the others' losses for its own and kept them past the rebuild that restored the class. Before Vite
7.1.10, an SSR build with `cssCodeSplit` off, a library's default, writes its sheet all the same, and such a rebuild
failed there too, though it writes that sheet again with the class's rule: what that sheet pruned no longer counts
against it, while what the client's pruned still does.

The error that guard raises now says the classes are in use as an environment finishes, rather than compiled in it,
names a rebuild of every environment at once in a watch among its causes, and offers writing the build's output,
announcing the run's environments, restarting the watch, or `pruneCss: false`. The warning a run that never completes
gives as the process exits now says the rules it lacks are those only an environment compiling after the sheet was
written reaches.
