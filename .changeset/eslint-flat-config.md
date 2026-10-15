---
'@bamboocss/eslint-plugin': minor
---

Add flat configs, `configs['flat/recommended']` and `configs['flat/all']`, for ESLint 9 and later. `configs.recommended`
and `configs.all` are `.eslintrc` configs, which flat config refuses with
`Key "parser": This appears to be in eslintrc format`; they are unchanged.

```js
// eslint.config.js
import bamboo from '@bamboocss/eslint-plugin'

export default [bamboo.configs['flat/recommended']]
```

- The flat configs name no parser and no `files`, so component files keep their own parser and ESLint lints no file it
  did not before. In a file ESLint lints as another language, such as CSS or JSON, the rules stand aside.
- The plugin and its configs type-check as ESLint's `ESLint.Plugin` and `Linter.Config`, so an `eslint.config.ts` using
  them compiles. With `meta.namespace`, `defineConfig` can extend `<name>/flat/recommended` for the plugin registered
  under any name, and renames its rules to match.
- The CommonJS and ES module builds give the same plugin, so a config importing one beside a shared config requiring the
  other no longer fails with `Cannot redefine plugin "bamboo"`.
- `@bamboocss/configPath` reads the config file it names, relative to ESLint's working directory, and says so when it
  does not exist. It was only where the search for a `bamboo.config.*` began, so a file by another name was never read.
- `@typescript-eslint/parser`, which the `.eslintrc` configs name, is an optional peer dependency, so a strict package
  manager can resolve it.
- A linting guide documents the setup, the settings and the rules.
