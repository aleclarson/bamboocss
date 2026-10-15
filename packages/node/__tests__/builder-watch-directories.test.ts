import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { Builder } from '../src/builder'

const project = mkdtempSync(join(tmpdir(), 'bamboo-builder-watch-'))
afterAll(() => rmSync(project, { force: true, recursive: true }))

/**
 * Where a dev server has to watch for a file appearing to reach the stylesheet: each folder that
 * `include` and `dependencies` are globbed from, wherever it is — outside the project included. A
 * negated pattern reads nothing, so it names no folder.
 */
test('the folders a file appearing can change the stylesheet from', async () => {
  writeFileSync(
    join(project, 'bamboo.config.ts'),
    `export default {
      include: ['src/**/*.tsx', '../shared/ui/**/*.tsx', '!src/legacy/**', '!(legacy)/**/*.mdx'],
      dependencies: ['theme/*.json'],
      outdir: 'styled-system',
      preflight: false,
    }\n`,
  )
  const builder = new Builder()
  await builder.setup({ cwd: project })
  const { cwd } = builder.getContextOrThrow().config

  expect(builder.getWatchDirectories()).toEqual([
    join(cwd, 'src'),
    resolve(cwd, '../shared/ui'),
    // `!(legacy)/**` is a glob walked from `cwd`, not a negation.
    cwd,
    join(cwd, 'theme'),
  ])
})
