import type { Linter } from 'eslint'
import { rules } from '../rules'
import { RULE_NAME as FileNotIncluded } from '../rules/file-not-included'
import { RULE_NAME as NoConfigFunctionInSource } from '../rules/no-config-function-in-source'
import { RULE_NAME as NoInvalidTokenPaths } from '../rules/no-invalid-token-paths'

const errorRules: string[] = [FileNotIncluded, NoConfigFunctionInSource, NoInvalidTokenPaths]

/** Every rule: an error where the build would be wrong, a warning otherwise. */
export const allRules: Linter.RulesRecord = Object.fromEntries(
  Object.keys(rules).map((name) => [`bamboo/${name}`, errorRules.includes(name) ? 'error' : 'warn']),
)
