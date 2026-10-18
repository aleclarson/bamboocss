---
'@bamboocss/vite': patch
---

On Vite 6, a build that sets `rollupOptions.output` finalizes the stylesheet it deferred. Vite 6 builds the outputs it
writes from `rollupOptions.output` before Bamboo's `options` hook runs, so the finalizer installed there was never on
the output written: in a run that builds the client before SSR, the client's sheet, deferred until SSR completed, was
never finalized, and a class only the server reaches shipped with no rule while the build passed, with only a warning at
exit. An environment whose output carries no finalizer now completes as one with no `rollupOptions.output` does. 1.56.7
had the same gap.
