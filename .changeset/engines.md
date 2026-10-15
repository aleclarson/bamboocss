---
'@bamboocss/config': patch
'@bamboocss/core': patch
'@bamboocss/dev': patch
'@bamboocss/eslint-plugin': patch
'@bamboocss/generator': patch
'@bamboocss/is-valid-prop': patch
'@bamboocss/logger': patch
'@bamboocss/mcp': patch
'@bamboocss/node': patch
'@bamboocss/plugin-lightningcss': patch
'@bamboocss/plugin-svelte': patch
'@bamboocss/plugin-vue': patch
'@bamboocss/preset-atlaskit': patch
'@bamboocss/preset-bamboo': patch
'@bamboocss/preset-base': patch
'@bamboocss/preset-open-props': patch
'@bamboocss/reporter': patch
'@bamboocss/shared': patch
'@bamboocss/token-dictionary': patch
'@bamboocss/types': patch
'@bamboocss/vite': patch
---

Every published package declares the Node.js it runs on, `engines: { node: ">=22.12.0" }`, so a package manager and
tooling can see it.

- No package said, and the floor was its dependencies': the PostCSS plugins the stylesheet is optimized with take no
  release before 22, and Vite none before 22.12. Node 20 reached its end of life in April 2026.
- tsdown builds for the version `engines` names. Every package's `dist` is the same, byte for byte.
