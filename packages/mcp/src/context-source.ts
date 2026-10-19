import type { BambooContext } from '@bamboocss/node'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The context, built again whenever a file the config was built from has changed since.
 *
 * An MCP server lives as long as the agent's session, and the config is what a session edits: a
 * token or a recipe added while the server ran never reached `get_tokens` or `get_recipes` until
 * the client restarted it. Checked when a tool is called rather than watched, so nothing has to
 * be torn down when the client goes, and the files are few: the config, the modules it imports —
 * a preset swapped in by the last edit among them — and the files its `dependencies` match.
 *
 * A config that fails to load fails the call that found it, with its own message, rather than
 * leaving the previous config answering as if nothing had changed; the next call tries again.
 */
export function createContextSource(load: () => Promise<BambooContext>): () => Promise<BambooContext> {
  let ctx: BambooContext | undefined
  let stamps = new Map<string, string>()
  let pending: Promise<BambooContext> | undefined

  const reload = async () => {
    try {
      const next = await load()
      ctx = next
      stamps = new Map(configFiles(next).map((file) => [file, stamp(file)]))
      return next
    } finally {
      pending = undefined
    }
  }

  return async () => {
    if (ctx && !changed(stamps)) return ctx
    // One load for the calls that find the change together.
    return (pending ??= reload())
  }
}

const stamp = (file: string) => {
  const stat = statSync(file, { throwIfNoEntry: false })
  return stat ? `${stat.mtimeMs}:${stat.size}` : 'missing'
}

const changed = (stamps: ReadonlyMap<string, string>) => {
  for (const [file, value] of stamps) if (stamp(file) !== value) return true
  return false
}

/** The config file, every module it imports, and the files its `dependencies` match. */
const configFiles = (ctx: BambooContext) => {
  const { cwd } = ctx.config
  const files = [ctx.conf.path, ...ctx.conf.dependencies, ...ctx.explicitDeps].filter(Boolean)
  return [...new Set(files.map((file) => resolve(cwd, file)))]
}
