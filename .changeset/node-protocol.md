---
'@bamboocss/dev': patch
'@bamboocss/config': patch
'@bamboocss/eslint-plugin': patch
'@bamboocss/mcp': patch
'@bamboocss/node': patch
---

The published ES modules import Node's built-ins with the `node:` prefix, the only spelling Deno resolves.

- Seventeen source files imported `fs`, `path`, `child_process` or `worker_threads` bare, and the built `dist` kept the
  specifier as written. So did the update notifier the CLI bundles.
- A lint rule keeps a bare built-in out of each package's source.
