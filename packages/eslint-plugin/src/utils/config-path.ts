import { findConfig } from '@bamboocss/config'
import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * The config the rules read: the file `@bamboocss/configPath` names, or the one found from a
 * directory it names — either relative to ESLint's working directory — and without it, the one
 * found from the file being linted. A file it named used to be only where the search began, so
 * one not called `bamboo.config.*` was never read, and the search went on to whichever config was
 * above it.
 *
 * From the file's directory rather than the file, which need not be on disk yet: a buffer an
 * editor has not saved, or `<input>` for text on stdin.
 */
export function configFor(options: { configPath?: string; currentFile: string; cwd?: string }): string {
  const cwd = options.cwd ?? process.cwd()
  if (!options.configPath) return findConfig({ cwd: path.dirname(path.resolve(cwd, options.currentFile)) })

  const configPath = path.resolve(cwd, options.configPath)
  const stats = statSync(configPath, { throwIfNoEntry: false })
  if (!stats) throw new Error(`\`@bamboocss/configPath\` names ${configPath}, which does not exist.`)
  if (!stats.isDirectory()) return configPath

  // The directory's own config, not one above it, which a search from it would go on to.
  let found: string | undefined
  try {
    found = findConfig({ cwd: configPath })
  } catch {
    // None anywhere above it either.
  }
  if (found === undefined || path.dirname(found) !== configPath) {
    throw new Error(`\`@bamboocss/configPath\` names ${configPath}, which holds no \`bamboo.config.*\`.`)
  }
  return found
}
