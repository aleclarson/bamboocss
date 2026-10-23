---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

The Vite plugin writes `styled-system/` again when a build finds it gone. Having generated it once, a set of plugin
instances wrote it only after a config change, so a process running several builds with the same plugins and cleaning
the output between them — a script timing cold builds, a test runner — failed every build after the first on
`Could not load styled-system/css`.
