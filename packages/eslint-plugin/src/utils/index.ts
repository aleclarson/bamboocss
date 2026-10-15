import { type run } from './worker'
import { ESLintUtils } from '@typescript-eslint/utils'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSyncFn } from 'synckit'

const ruleCreator = ESLintUtils.RuleCreator(
  (name) => `https://github.com/gajus/bamboocss/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
)

/**
 * A rule that walks a JavaScript program, and stands aside for any file that is not one.
 *
 * ESLint lints CSS, JSON and Markdown as languages of their own and runs a rule wherever a config
 * turns it on, so a config applying to every file hands these rules a stylesheet or a document.
 * Scoping the configs with `files` would not do instead: in flat config a `files` pattern adds
 * the files it matches to those ESLint lints, and a `.jsx` or `.vue` file with no parser for it
 * would then fail to parse.
 */
export const createRule: typeof ruleCreator = (rule) => {
  const module = ruleCreator(rule)
  return {
    ...module,
    create: (context) => {
      // `sourceCode` is ESLint 8.40's; before it, every file ESLint lints is a program.
      const type = (context as { sourceCode?: { ast?: { type?: string } } }).sourceCode?.ast?.type
      return type === undefined || type === 'Program' ? module.create(context) : {}
    },
  }
}

// Determine the distribution directory. Under test the plugin is loaded from
// `src/utils/index.ts`, so the built worker sits two levels up in `dist`; when
// published it is `dist/index.mjs` alongside `dist/utils`. Deriving this from
// the module URL keeps it independent of NODE_ENV, which consumers may set.
const isSourceRun = import.meta.url.endsWith('/src/utils/index.ts')

const distDir = fileURLToPath(new URL(isSourceRun ? '../../dist' : './', import.meta.url))

// Create synchronous function using synckit
const _syncAction = createSyncFn(join(distDir, 'utils/worker.mjs'))

// Define syncAction with proper typing and error handling
const cache = new Map<string, any>()

export const syncAction = ((...args: Parameters<typeof run>) => {
  // Generate cache key from arguments
  const cacheKey = JSON.stringify(args)

  // Return cached result if exists
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  try {
    const result = _syncAction(...args)
    // Store result in cache
    cache.set(cacheKey, result)
    return result
  } catch (error) {
    console.error('syncAction error:', error)
    return undefined
  }
}) as typeof run

/**
 * `syncAction` without its cache, for an action given the file's text: a cache keyed by every
 * version of every file an editor lints would only grow.
 */
export const syncActionUncached = ((...args: Parameters<typeof run>) => {
  try {
    return _syncAction(...args)
  } catch (error) {
    console.error('syncAction error:', error)
    return undefined
  }
}) as typeof run

export type ImportResult = {
  alias: string
  importMapValue?: string
  mod: string
  name: string
}
