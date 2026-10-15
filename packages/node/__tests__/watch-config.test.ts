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
