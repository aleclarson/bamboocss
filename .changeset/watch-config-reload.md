---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

`vite build --watch` reads the config again only when a file it was read from has changed, as the dev server does.

- It used to bundle and evaluate the config on every rebuild. An ES module config is imported fresh each time, and Node
  never releases a module it has imported, so each rebuild left one more copy of the config, and every preset inlined
  into it, in memory until the build stopped.
- The files checked are the config, everything it imports, its `dependencies` and the tsconfig files it resolves
  through. The `dependencies` globs are matched again on each rebuild, so a file added to one is read with the next
  rebuild something else starts — a build watches the files its config read, not the folders a glob would find a new one
  in — at the cost of matching them: a pattern over the whole project walks it, `node_modules` and all, each time.
- A file the config reads without listing it in `dependencies`, and a preset named by its package, are read again only
  when the config is, as on the dev server.
