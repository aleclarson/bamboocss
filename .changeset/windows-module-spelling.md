---
'@bamboocss/vite': patch
---

Find a module the bundler names by a spelling of its own where it really is, and tell the generated runtime from the
project's source whatever case a Windows drive letter is in.

- Vite 8 names a module a Windows junction reaches by the target the junction stores, which can spell a folder short
  (`RUNNER~1`) or in a case the disk does not. The inventory holds the file as it really is, and the build refused the
  classes compiled for it as outside the CSS extraction graph. A module the build does not find is looked up once more
  as it really is.
- A project started from a shell that spells the drive letter in lower case, `d:\app`, compiled its generated
  `styled-system` runtime as its own source.
