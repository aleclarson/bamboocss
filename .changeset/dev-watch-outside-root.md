---
'@bamboocss/vite': patch
'@bamboocss/node': patch
---

A file added under an `include` outside the dev server's root reaches the stylesheet.

- Vite watches its root, and a file outside it only once something has loaded it, so an edit to a file the stylesheet
  was built from was always seen. A file added there — a new component in a workspace package that `include` names as
  `../ui/src/**` — had nothing watching its folder, and the stylesheet went on without it until the server restarted.
- The folders `include` and `dependencies` are globbed from are now handed to the dev server's watcher where they lie
  outside its root, however the two are spelled: as each pass begins, so a config reload that moves them is followed,
  and as a restarted server is configured. A folder not there yet is watched for, and one deleted and built again — a
  package's `dist` — is watched again.
- `include: ['**/*.tsx']` beside a pattern with a folder of its own — `['**/*.tsx', '../shared/**']` — left `cwd` out of
  the folders `bamboo --watch` watches, so a file added or edited under it went unseen. It is watched now.
