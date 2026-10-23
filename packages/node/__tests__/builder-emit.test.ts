import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { Builder } from '../src/builder'

/**
 * What `emit` writes, and when.
 *
 * It is the only thing that puts `styled-system/` on disk for an integration — the PostCSS
 * plugin and the Vite plugin both call it — and for the first call it wrote nothing at all. The
 * guard read `hasEmitted` before the same method had ever set it, so a run started by the flag
 * being false fell straight through, and artifacts appeared only on a *later* call that also
 * carried a config change. A clone with no generated output got none from `vite dev` or
 * `vite build`; every project has had to run the CLI first.
 *
 * The narrowing the guard was reaching for is real and still here: a watch rebuild re-emits only
 * what a config change affected, and one that changed no config writes nothing.
 *
 * A stub context rather than a real one — `codegen` is covered on its own, and what is asserted
 * here is which artifacts `emit` hands it. Its output directory is real, since whether that is
 * still on disk is one of the things `emit` asks.
 */
const outdirs: string[] = []
afterAll(() => {
  for (const outdir of outdirs) rmSync(outdir, { recursive: true, force: true })
})

const stubBuilder = () => {
  const written: string[] = []
  const builder = new Builder()
  const outdir = mkdtempSync(join(tmpdir(), 'bamboo-emit-'))
  outdirs.push(outdir)

  builder.context = {
    config: {},
    paths: { root: [outdir] },
    runtime: { path: { join } },
    // Labelled by what was asked for, so a filtered emit is distinguishable from a full one.
    getArtifacts: (ids?: string[]) => [{ files: [{ file: `${(ids ?? ['all']).join('+')}.mjs`, code: 'x' }] }],
    output: {
      empty: () => {},
      prune: () => ({ removed: 0 }),
      write: (artifact: { files: { file: string }[] }) => {
        for (const { file } of artifact.files) written.push(file)
        return Promise.resolve([])
      },
    },
    hooks: {},
    initMessage: () => '',
    messages: { artifactsGenerated: () => '' },
  } as any

  /** `affecteds` is private, and is set by `setup` from a real config diff. */
  const configChanged = (artifacts: string[] | undefined, paths: string[] = ['theme']) => {
    ;(builder as unknown as { affecteds: unknown }).affecteds = artifacts && {
      artifacts: new Set(artifacts),
      hasConfigChanged: true,
      diffs: paths.map((path) => ({ type: 'CHANGE', path: [path] })),
    }
  }

  return { builder, configChanged, outdir, written }
}

describe('builder.emit', () => {
  test('writes every artifact the first time, which is the only time a clone has none', async () => {
    const { builder, written } = stubBuilder()

    await builder.emit()

    expect(written, 'the whole generated system, not a subset').toEqual(['all.mjs'])
  })

  test('writes nothing again when no config changed', async () => {
    const { builder, written } = stubBuilder()

    await builder.emit()
    written.length = 0
    await builder.emit()

    // Every dev-server regeneration reaches this; rewriting the system each time would be a
    // file event per artifact, which is what the original guard was protecting against.
    expect(written).toEqual([])
  })

  test('writes only the artifacts a later config change affected', async () => {
    const { builder, configChanged, written } = stubBuilder()

    await builder.emit()
    written.length = 0

    configChanged(['css', 'tokens'])
    await builder.emit()

    expect(written).toEqual(['css+tokens.mjs'])
  })

  // Every artifact, as a run from cold writes them, after an edit to what all of them are written
  // from. Rebuilt from those the edit matched, the ones no option names kept the old extension.
  test('writes every artifact after a config change to what all of them are written from', async () => {
    const { builder, configChanged, written } = stubBuilder()

    await builder.emit()
    written.length = 0

    configChanged(['css', 'tokens'], ['outExtension'])
    await builder.emit()

    expect(written).toEqual(['all.mjs'])
  })

  /**
   * Having written them once is not having them on disk. A process reusing its plugin instances
   * across builds, and cleaning `styled-system/` between them, failed every build after the first.
   */
  test('writes every artifact again when the output directory is gone', async () => {
    const { builder, outdir, written } = stubBuilder()

    await builder.emit()
    written.length = 0
    rmSync(outdir, { recursive: true, force: true })
    await builder.emit()

    expect(written).toEqual(['all.mjs'])
  })
})
