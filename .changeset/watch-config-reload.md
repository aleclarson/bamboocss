---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

`vite build --watch` reads the config again only when a file it was read from has changed, as the dev server does.

- It used to bundle and evaluate the config on every rebuild. An ES module config is imported fresh each time, and Node
  never releases a module it has imported, so each rebuild left one more copy of the config, and every preset inlined
  into it, in memory until the build stopped.
- The files checked are the config, everything it imports, its `dependencies` and the tsconfig files it resolves
  through. A preset named by its package is not among them, so in watch mode, as in dev, it is read again only when the
  config is.
