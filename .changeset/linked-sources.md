---
'@bamboocss/vite': patch
'@bamboocss/node': patch
'@bamboocss/types': patch
---

A source `include` reaches through a symbolic link — a workspace package linked into `node_modules`, a folder or file
linked into `src`, or a project folder that is itself reached through one, as everything under `/tmp` is on macOS — and
Vite builds it.

- Vite names a module by where it really is, which is not the path the source glob found it at through the link. So a
  module compiled under that name looked like no source at all: `vite build` refused its classes as "outside the CSS
  extraction graph", though `include` named it, and in dev its edits never reached the stylesheet, nor did a file added
  beside it.
- The glob now reports where it began and every folder and file it reached through a link, and each source is known by
  where it really is too: a module Vite compiles, edits or adds under that name is the source it is, each way the
  inventory spells it. A workspace package's folder is watched where it really lies — through a wildcard such as
  `node_modules/@acme/*/src/**` as well — since Vite's watcher passes over `node_modules`.
- A file the glob reaches by two paths is still read by both, as before.
- A project with no such link pays nothing. One with a link pays about 0.17 µs for each module the compiler asks about,
  and under a millisecond each time the glob runs.
