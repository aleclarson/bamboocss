---
'@bamboocss/vite': patch
'@bamboocss/node': patch
'@bamboocss/config': patch
---

Name files in messages the same way on Windows as everywhere else, with `/`.

- A refused call, and a class the stylesheet pass never saw, name their file as `src/theme.ts` rather than
  `src\theme.ts`, as Vite's own errors do.
- A file that could not be extracted, and a call to a binding that does not exist, are named relative to the project. On
  Windows the glob spells a file `C:/app/src/a.tsx` and the project is `C:\app`, so these printed absolute.
- `bamboo doctor` lists the files it reports with `/`. Its `--json` report is unchanged.
- A config that throws says where in its source on Windows too. The stack named the bundle with `/`, or under the long
  name of a folder Windows spells short (`RUNNER~1`), so no frame matched it and the location was left out.
