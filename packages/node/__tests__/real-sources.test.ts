import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { nodeRuntime } from '../src/node-runtime'
import { firstSpellingOfEachFile } from '../src/real-sources'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-real-sources-')))
afterAll(() => rmSync(root, { force: true, recursive: true }))

const spelled = (...segments: string[]) => join(root, ...segments).replaceAll('\\', '/')
const kind = process.platform === 'win32' ? 'junction' : 'dir'

test('keeps each real file once, under the first path the inventory has it by', () => {
  mkdirSync(join(root, 'packages/ui/src'), { recursive: true })
  mkdirSync(join(root, 'app/src'), { recursive: true })
  mkdirSync(join(root, 'app/vendor'), { recursive: true })
  writeFileSync(join(root, 'packages/ui/src/card.tsx'), '')
  writeFileSync(join(root, 'app/src/app.tsx'), '')
  symlinkSync(join(root, 'packages/ui/src'), join(root, 'app/src/shared'), kind)
  symlinkSync(join(root, 'packages/ui/src'), join(root, 'app/vendor/shared'), kind)

  const files = [spelled('app/src/app.tsx'), spelled('app/src/shared/card.tsx'), spelled('app/vendor/shared/card.tsx')]
  const linked = [spelled('app/src'), spelled('app/src/shared'), spelled('app/vendor/shared')]

  expect(firstSpellingOfEachFile(files, linked)).toEqual([
    spelled('app/src/app.tsx'),
    spelled('app/src/shared/card.tsx'),
  ])
})

// The case nearly every project is: nothing to resolve, and nothing looked up.
test('hands back the files as they are where the glob reached no link', () => {
  const files = [spelled('app/src/app.tsx')]
  expect(firstSpellingOfEachFile(files, [])).toBe(files)
  expect(firstSpellingOfEachFile(files, [spelled('app/src')]), 'a folder that is no link').toBe(files)
})

// A project itself under a link — macOS's temporary folder is — where a file reached directly is
// spelled through it and one reached through a link in it is resolved. The glob reports the folder
// each walk began at, which resolves the first as much as the second.
test('keeps a file once in a project under a link of its own, as the glob reports it', () => {
  const linkedRoot = join(root, 'linked-root')
  mkdirSync(join(root, 'real-root/app/src/shared'), { recursive: true })
  mkdirSync(join(root, 'real-root/app/vendor'), { recursive: true })
  writeFileSync(join(root, 'real-root/app/src/shared/card.tsx'), '')
  symlinkSync(join(root, 'real-root/app/src/shared'), join(root, 'real-root/app/vendor/shared'), kind)
  symlinkSync(join(root, 'real-root'), linkedRoot, kind)
  const cwd = join(linkedRoot, 'app')

  for (const include of [
    ['src/**/*.tsx', 'vendor/**/*.tsx'],
    ['src/shared/card.tsx', 'vendor/shared/card.tsx'],
  ]) {
    const linked: string[] = []
    const files = nodeRuntime.fs.glob({ cwd, include, linked })
    expect(files, String(include)).toHaveLength(2)
    expect(firstSpellingOfEachFile(files, linked), String(include)).toEqual([
      spelled('linked-root/app/src/shared/card.tsx'),
    ])
  }
})
