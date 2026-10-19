import { createContext as createFixtureContext } from '@bamboocss/fixture'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { loadConfigAndCreateContext } from '../src/config'
import { BambooContext as BambooContextClass, type BambooContext } from '../src/create-context'
import { nodeRuntime } from '../src/node-runtime'

/**
 * The config reloads when a file it depends on appears, not only when one changes.
 *
 * Its dependencies include the tsconfigs its aliases resolve through, and under a solution-style
 * root one of those can be a referenced project that does not exist yet: writing it is an `add`,
 * which the watcher used to drop, so the aliases it declares were not seen until a restart.
 */
const watched = () => {
  const emitter = new EventEmitter()
  const ctx = createFixtureContext() as unknown as BambooContext
  ctx.runtime = {
    ...ctx.runtime,
    fs: { ...ctx.runtime.fs, watch: (() => emitter) as unknown as BambooContext['runtime']['fs']['watch'] },
  }
  const reloaded: string[] = []
  ctx.watchConfig((file) => {
    reloaded.push(file)
  })
  return { emitter, reloaded }
}

/** The reload is debounced, so an emitted event is not observable until the queue drains. */
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

test.each(['add', 'change'])('on `%s` of a file it depends on', async (event) => {
  const { emitter, reloaded } = watched()

  emitter.emit('all', event, 'tsconfig.app.json')
  await settle()

  expect(reloaded).toEqual(['tsconfig.app.json'])
})

// A checkout removes and restores files, and a reload in between fails on the file it removed.
test('not on one going, nor on a directory', async () => {
  const { emitter, reloaded } = watched()

  emitter.emit('all', 'unlink', 'tsconfig.app.json')
  emitter.emit('all', 'addDir', 'src')
  emitter.emit('all', 'unlinkDir', 'src')
  await settle()

  expect(reloaded).toEqual([])
})

/**
 * The watch follows what the config is built from as it changes. Armed once with the files the
 * first config imported, an edit that swapped in a preset left the new file unwatched, and editing
 * the preset did nothing until the process restarted.
 */
test('a file the reloaded config starts importing is watched from then on', async () => {
  const armed: Array<{ include: string[]; emitter: EventEmitter & { close: () => Promise<void> }; closed: boolean }> =
    []
  const ctx = createFixtureContext() as unknown as BambooContext
  ctx.runtime = {
    ...ctx.runtime,
    fs: {
      ...ctx.runtime.fs,
      watch: ((options: { include: string[] }) => {
        const emitter = Object.assign(new EventEmitter(), { close: async () => void (entry.closed = true) })
        const entry = { include: options.include, emitter, closed: false }
        armed.push(entry)
        return emitter
      }) as unknown as BambooContext['runtime']['fs']['watch'],
    },
  }
  ctx.conf = { ...ctx.conf, dependencies: ['bamboo.config.ts'] }

  const next = createFixtureContext() as unknown as BambooContext
  next.conf = { ...next.conf, dependencies: ['bamboo.config.ts', 'brand.ts'] }

  const reloaded: string[] = []
  ctx.watchConfig((file) => {
    reloaded.push(file)
    return next
  })
  expect(armed.map((entry) => entry.include)).toEqual([['bamboo.config.ts']])

  armed[0]!.emitter.emit('all', 'change', 'bamboo.config.ts')
  await settle()
  expect(armed.map((entry) => entry.include)).toEqual([['bamboo.config.ts'], ['bamboo.config.ts', 'brand.ts']])
  expect(armed[0]!.closed).toBe(true)

  armed[1]!.emitter.emit('all', 'change', 'brand.ts')
  await settle()
  expect(reloaded).toEqual(['bamboo.config.ts', 'brand.ts'])
  // The same files again, so the same watcher.
  expect(armed).toHaveLength(2)
})

describe('the files the watch follows', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach((root) => rmSync(root, { force: true, recursive: true })))

  const project = (files: Record<string, string>) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-watch-files-')))
    roots.push(root)
    for (const [file, contents] of Object.entries(files)) writeFileSync(join(root, file), contents)
    return { root, write: (file: string, contents: string) => writeFileSync(join(root, file), contents) }
  }

  const config = (body: string, imports = '') =>
    `${imports}\nexport default { preflight: false, include: ['src/**/*.ts'], outdir: 'styled-system', theme: { extend: { tokens: { colors: ${body} } } } }\n`

  // The ordinary refactor: the same tokens, moved into a module the config imports. What the config
  // resolves to is unchanged, so the context is kept, and it went on naming the old files.
  test('a reload that changes only what the config imports updates the context it keeps', async () => {
    const { root, write } = project({ 'bamboo.config.ts': config(`{ brand: { value: '#111' } }`) })
    const ctx = await loadConfigAndCreateContext({ cwd: root })

    write('tokens.ts', `export const colors = { brand: { value: '#111' } }\n`)
    write('bamboo.config.ts', config('colors', `import { colors } from './tokens'`))
    let replaced = false
    const affected = await ctx.diff.reloadConfigAndRefreshContext(() => {
      replaced = true
    })

    expect(affected.hasConfigChanged).toBe(false)
    expect(replaced).toBe(false)
    expect(ctx.conf.dependencies.map((file) => resolve(root, file))).toContain(join(root, 'tokens.ts'))
  })

  // The file that broke the reload is the one about to be fixed, and no context was built to name it.
  test('a module swapped in by a reload that fails is watched, so fixing it reloads', async () => {
    const { root, write } = project({
      'a.ts': `export const colors = { brand: { value: '#111' } }\n`,
      'bamboo.config.ts': config('colors', `import { colors } from './a'`),
    })
    const ctx = await loadConfigAndCreateContext({ cwd: root })
    const armed: string[][] = []
    const emitters: EventEmitter[] = []
    ctx.runtime = {
      ...ctx.runtime,
      fs: {
        ...ctx.runtime.fs,
        watch: ((options: { include: string[] }) => {
          armed.push(options.include)
          const emitter = Object.assign(new EventEmitter(), { close: async () => {} })
          emitters.push(emitter)
          return emitter
        }) as unknown as BambooContext['runtime']['fs']['watch'],
      },
    }

    write('b.ts', `throw new Error('not yet')\n`)
    write('bamboo.config.ts', config('colors', `import { colors } from './b'`))
    ctx.watchConfig(() => {
      throw new Error('the config failed to load')
    })
    emitters[0]!.emit('all', 'change', 'bamboo.config.ts')
    await settle()

    expect(armed).toHaveLength(2)
    expect(armed[1]!.map((file) => resolve(root, file))).toContain(join(root, 'b.ts'))
  })

  const recording = (ctx: BambooContext) => {
    const armed: string[][] = []
    const emitters: EventEmitter[] = []
    ctx.runtime = {
      ...ctx.runtime,
      fs: {
        ...ctx.runtime.fs,
        watch: ((options: { include: string[] }) => {
          armed.push(options.include)
          const emitter = Object.assign(new EventEmitter(), { close: async () => {} })
          emitters.push(emitter)
          return emitter
        }) as unknown as BambooContext['runtime']['fs']['watch'],
      },
    }
    return { armed, emitters }
  }

  // The reload worked and the build after it did not: the reloaded context still names the files,
  // and the one to fix is the preset the edit added.
  test('a reload whose build fails is followed by what it reloaded', async () => {
    const { root } = project({ 'bamboo.config.ts': config(`{}`) })
    const ctx = await loadConfigAndCreateContext({ cwd: root })
    const { armed, emitters } = recording(ctx)
    const next = await loadConfigAndCreateContext({ cwd: root })
    next.conf.dependencies = [...next.conf.dependencies, join(root, 'brand.ts')]

    ctx.watchConfig((_file, reloaded) => {
      reloaded(next)
      throw new Error('a recipe in the new preset names no token')
    })
    emitters[0]!.emit('all', 'change', 'bamboo.config.ts')
    await settle()

    expect(armed[1]).toContain(join(root, 'brand.ts'))
  })

  // A preset named by path is bundled on its own, so the config's imports do not name it; the
  // load that threw on it does.
  test('a preset named by path that fails to load is watched, so fixing it reloads', async () => {
    const { root, write } = project({ 'bamboo.config.ts': config(`{}`) })
    let ctx = await loadConfigAndCreateContext({ cwd: root })
    const { armed, emitters } = recording(ctx)

    write('brand.ts', `throw new Error('not yet')\n`)
    write(
      'bamboo.config.ts',
      `export default { preflight: false, include: ['src/**/*.ts'], outdir: 'styled-system', presets: ['./brand.ts'] }\n`,
    )
    ctx.watchConfig(async (_file, reloaded) => {
      await ctx.diff.reloadConfigAndRefreshContext((conf) => {
        ctx = new BambooContextClass(conf)
      })
      reloaded(ctx)
      return ctx
    })
    emitters[0]!.emit('all', 'change', 'bamboo.config.ts')
    await settle(1500)

    expect(armed).toHaveLength(2)
    expect(armed[1]!.map((file) => resolve(root, file))).toContain(join(root, 'brand.ts'))
  })

  // Armed on the files it matched, a file that starts to match was never seen.
  test('a `dependencies` pattern is watched as a pattern', async () => {
    const { root } = project({
      'bamboo.config.ts': `export default { preflight: false, include: ['src/**/*.ts'], outdir: 'styled-system', dependencies: ['tokens/*.json'] }\n`,
    })
    const ctx = await loadConfigAndCreateContext({ cwd: root })
    const { armed } = recording(ctx)
    ctx.watchConfig(() => {})

    expect(armed[0]).toContain('tokens/*.json')
  })

  // Re-armed once per edit that changes the files, each watcher used to leave its listener behind.
  test('a closed watcher lets go of its interrupt listener', async () => {
    const { root } = project({ 'bamboo.config.ts': config(`{}`) })
    const before = process.listenerCount('SIGINT')
    const watcher = nodeRuntime.fs.watch({ include: ['bamboo.config.ts'], cwd: root })
    expect(process.listenerCount('SIGINT')).toBe(before + 1)

    await watcher.close()
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})
