---
'@bamboocss/vite': patch
---

On Windows, an edit to a file only the extractor reads — a JSON theme, a module nothing imports — repaints the dev
stylesheet.

- Vite's watcher reports `C:\app\src\theme.json`, and the set of extracted files held `C:/app/src/theme.json`, so the
  edit was taken for one to a file the sheet does not depend on, and dropped. Both are now held and looked up under one
  spelling, separators and the drive letter's case included.
- The same key is used where a build checks that every statically compiled module is one the extraction read.
