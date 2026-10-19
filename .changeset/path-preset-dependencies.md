---
'@bamboocss/config': patch
---

A preset named by path in `presets`, `presets: ['./brand.ts']`, counts among the config's files. It is bundled on its
own, so only the config bundle's files were tracked, and an edit to the preset was not seen by `--watch`, the MCP server
or a dev server's next build until something else changed.
