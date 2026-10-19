---
'@bamboocss/core': patch
'@bamboocss/node': patch
---

`bamboo init` prints the Vite setup as its next steps: add `bamboocss()` to the Vite config, import `virtual:bamboo.css`
once, and add `"prepare": "bamboo codegen"`. It printed Panda's instead, a stylesheet of your own holding
`@layer reset, base, tokens, recipes, utilities;`, which the virtual stylesheet declares itself, without `recipes`.

- On a project that already has a config, it says the config was left as it is and how to replace it,
  `npx bamboo init --force`, where it suggested `npm run bamboo --watch`.
