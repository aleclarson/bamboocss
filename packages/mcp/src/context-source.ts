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
 * a preset swapped in by the last edit among them, or one named by path in `presets` — and the
 * files its `dependencies` match, including one that starts to match.
 *
 * A config that fails to load fails the call that found it, with its own message, rather than
 * leaving the previous config answering as if nothing had changed; the next call tries again.
 */
export function createContextSource(load: () => Promise<BambooContext>): () => Promise<BambooContext> {
  let ctx: BambooContext | undefined
  let stamps = new Map<string, string>()
  let members: string | undefined
  let pending: Promise<BambooContext> | undefined

  const reload = async () => {
    // Taken before the load reads anything, so an edit landing while it runs still reads as one
    // afterwards: stamped once the load had finished, it was recorded as already seen.
    const started = Date.now()
    const before = new Map(Array.from(stamps.keys(), (file) => [file, stamp(file)]))
    try {
      const next = await load()
      ctx = next
      stamps = new Map(configFiles(next).map((file) => [file, before.get(file) ?? stampSince(file, started)]))
      members = matched(next)
      return next
    } finally {
      pending = undefined
    }
  }

  return async () => {
    if (ctx && !changed(stamps) && matched(ctx) === members) return ctx
    // One load for the calls that find the change together.
    return (pending ??= reload())
  }
}

const stamp = (file: string) => {
  const stat = statSync(file, { throwIfNoEntry: false })
  return stat ? `${stat.mtimeMs}:${stat.size}` : 'missing'
}

/** A file the last load read for the first time: changed already if it was written since the load began. */
const stampSince = (file: string, started: number) => {
  const stat = statSync(file, { throwIfNoEntry: false })
  if (!stat) return 'missing'
  return stat.mtimeMs >= started ? 'changed' : `${stat.mtimeMs}:${stat.size}`
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

/**
 * What `dependencies` matches now. A file that starts to match is one no stamp was taken of, and a
 * config that reads a folder — `tokens/*.json` — changes with it.
 */
const matched = (ctx: BambooContext) => {
  const { dependencies, cwd } = ctx.config
  if (!dependencies?.length) return undefined
  return ctx.runtime.fs
    .glob({ include: dependencies, cwd })
    .map((file) => resolve(cwd, file))
    .sort()
    .join('\n')
}
