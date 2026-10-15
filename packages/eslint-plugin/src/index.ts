import type { ESLint, Linter, Rule } from 'eslint'
import { name, version } from '../package.json'
import { allRules } from './configs/all'
import { recommendedRules } from './configs/recommended'
import { rules } from './rules'

type Configs = {
  /** The rules meant for any project, for `.eslintrc`: `extends: ['plugin:bamboo/recommended']`. */
  recommended: Linter.LegacyConfig
  /** Every rule, for `.eslintrc`: `extends: ['plugin:bamboo/all']`. */
  all: Linter.LegacyConfig
  /** The rules meant for any project, for flat config: `export default [bamboo.configs['flat/recommended']]`. */
  'flat/recommended': Linter.Config
  /** Every rule, for flat config. */
  'flat/all': Linter.Config
}

const plugin = {
  meta: { name, namespace: 'bamboo', version },
  // `@typescript-eslint/utils` types a rule's context with the methods ESLint 9 removed from it —
  // `getScope`, `getAncestors` — so ESLint's own types refuse these rules, though ESLint runs them:
  // they call none of those.
  rules: rules as unknown as { [Name in keyof typeof rules]: Rule.RuleModule },
  configs: {} as Configs,
} satisfies ESLint.Plugin

/**
 * Flat config, ESLint's since 9 and its only one since 10. `recommended` and `all` stay the
 * `.eslintrc` configs they always were, which flat config refuses — `Key "parser": This appears to
 * be in eslintrc format`.
 *
 * Neither names a parser, nor `files`. A parser for every file would take `.vue`, `.svelte` and
 * `.astro` files from their own; TypeScript sources take the one the project configures. And
 * `files` would add the files it matches to those ESLint lints — the rules stand aside instead in
 * a file that is not JavaScript (`createRule`).
 */
const flat = (configName: string, ruleSettings: Linter.RulesRecord): Linter.Config => ({
  name: configName,
  plugins: { bamboo: plugin },
  rules: ruleSettings,
})

const legacy = (ruleSettings: Linter.RulesRecord): Linter.LegacyConfig => ({
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module' },
  plugins: ['bamboo'],
  rules: ruleSettings,
})

plugin.configs = {
  recommended: legacy(recommendedRules),
  all: legacy(allRules),
  'flat/recommended': flat('bamboo/recommended', recommendedRules),
  'flat/all': flat('bamboo/all', allRules),
}

/**
 * One plugin however it is loaded. Its flat configs carry the plugin itself, and ESLint refuses
 * two objects under one name — `Cannot redefine plugin "bamboo"` — which the CommonJS and ES
 * module builds would be, loaded side by side: a config importing one, a shared config requiring
 * the other.
 */
const shared = Symbol.for(`${name}@${version}`)

export default ((globalThis as Record<symbol, unknown>)[shared] ??= plugin) as typeof plugin
