---
'@bamboocss/dev': patch
'@bamboocss/node': patch
'@bamboocss/shared': patch
---

Refuse to build from an argument that names nothing, instead of emptying the stylesheet. `bamboo` reads its argument as
an `include` glob, so a mistyped or never-defined command — `bamboo codgen`, `bamboo doctor` — and any glob or path
matching nothing built a stylesheet from no files over the real one, and exited 0. It now fails and leaves the
stylesheet as it was. A word is answered as the command it most likely meant; a glob or path is reported as matching
nothing, and a directory, `bamboo src`, with the glob to write instead. While watching, only a word one slip from a
command is refused, since the files may be about to appear.

`bamboo <glob> --watch` now rebuilds when a file changes. The argument reached the watcher as a string where a list was
expected, so it watched a directory for each character of the glob.

`generate()` takes `{ requireFiles: true }` for the same refusal.
