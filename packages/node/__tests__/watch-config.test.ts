import { createContext as createFixtureContext } from '@bamboocss/fixture'
import { EventEmitter } from 'node:events'
import { expect, test } from 'vitest'
import type { BambooContext } from '../src/create-context'

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
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

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
