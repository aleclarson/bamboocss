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

// What the glob takes from `include`, membership takes too: a negation there passes over what it
// names, and over nothing else — it used to make every path there is a source.
test('a source is what the glob would read', async () => {
  const builder = new Builder()
  await builder.setup({ cwd: project })
  const { cwd } = builder.getContextOrThrow().config

  expect(builder.isPotentialSourceFile(join(cwd, 'src/app.tsx'))).toBe(true)
  expect(builder.isPotentialSourceFile(join(cwd, 'src/legacy/old.tsx'))).toBe(false)
  expect(builder.isPotentialSourceFile(join(cwd, 'README.md'))).toBe(false)
  expect(builder.isPotentialSourceFile(join(cwd, 'node_modules/react/index.js'))).toBe(false)
})
