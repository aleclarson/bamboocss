import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { Builder } from '../src/builder'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-builder-linked-')))
afterAll(() => rmSync(root, { force: true, recursive: true }))

/**
 * A workspace package linked into `node_modules`, as pnpm links one, and `include` spelled through
 * that link. A bundler names each of its modules by where it really is, which is a path the
 * inventory never globbed: compiled, edited and added under it, a module looked like no source at
 * all — its classes were refused by the build's check, and its edits never reached the sheet.
 */
test('knows a source reached through a link by where it really is', async () => {
  const app = join(root, 'app')
  const ui = join(root, 'packages/ui')
  mkdirSync(join(app, 'src'), { recursive: true })
  mkdirSync(join(app, 'node_modules/@acme'), { recursive: true })
  mkdirSync(join(ui, 'src'), { recursive: true })
  writeFileSync(
    join(app, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.tsx', 'node_modules/@acme/ui/src/**/*.tsx'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(join(app, 'src/app.tsx'), `export const app = 'app'\n`)
  writeFileSync(join(ui, 'src/card.tsx'), `export const card = 'card'\n`)
  symlinkSync(ui, join(app, 'node_modules/@acme/ui'), process.platform === 'win32' ? 'junction' : 'dir')

  const builder = new Builder()
  await builder.setup({ cwd: app })
  builder.extract()
  const linked = join(app, 'node_modules/@acme/ui/src/card.tsx').replaceAll('\\', '/')
  const real = join(ui, 'src/card.tsx').replaceAll('\\', '/')

  expect(builder.getSourceFiles()).toContain(linked)
  expect(builder.getRealSourceFiles()).toEqual([real])
  expect(builder.toSourcePaths(real)).toEqual([linked])
  // Not reached through a link, so as it is.
  expect(builder.toSourcePaths(join(app, 'src/app.tsx'))).toEqual([])
  // A file that is not there yet, where the link leads: a source, as the inventory would spell it.
  expect(builder.isPotentialSourceFile(join(ui, 'src/new.tsx'))).toBe(true)
  expect(builder.isPotentialSourceFile(join(ui, 'README.md'))).toBe(false)
})

/**
 * One package two links reach, both in `include`: the inventory reads its files by both, as it
 * reads any file two paths reach, so a change named by where it really is has to reach both.
 */
test('knows a source two links reach by each of them', async () => {
  const app = join(root, 'two-links')
  const ui = join(root, 'packages/shared')
  mkdirSync(join(app, 'src'), { recursive: true })
  mkdirSync(join(app, 'vendor'), { recursive: true })
  mkdirSync(join(ui, 'src'), { recursive: true })
  writeFileSync(
    join(app, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.tsx', 'vendor/**/*.tsx'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(join(ui, 'src/card.tsx'), `export const card = 'card'\n`)
  const kind = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(join(ui, 'src'), join(app, 'src/shared'), kind)
  symlinkSync(join(ui, 'src'), join(app, 'vendor/shared'), kind)

  const builder = new Builder()
  await builder.setup({ cwd: app })
  builder.extract()
  const spelled = (path: string) => join(app, path).replaceAll('\\', '/')

  expect([...builder.toSourcePaths(join(ui, 'src/card.tsx'))].sort()).toEqual([
    spelled('src/shared/card.tsx'),
    spelled('vendor/shared/card.tsx'),
  ])
})

/**
 * And reads it once: under the first of the paths, which wrote its atoms first and so ranks them in
 * the stylesheet as both did. Read under each, it was extracted twice for the same styles.
 */
test('extracts a source two links reach once', async () => {
  const app = join(root, 'two-links-once')
  const ui = join(root, 'packages/once')
  mkdirSync(join(app, 'src'), { recursive: true })
  mkdirSync(join(app, 'vendor'), { recursive: true })
  mkdirSync(join(ui, 'src'), { recursive: true })
  writeFileSync(
    join(app, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.tsx', 'vendor/**/*.tsx'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(
    join(ui, 'src/card.tsx'),
    `import { css } from '../../../two-links-once/styled-system/css'\nexport const card = css({ color: 'red.300' })\n`,
  )
  const kind = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(join(ui, 'src'), join(app, 'src/shared'), kind)
  symlinkSync(join(ui, 'src'), join(app, 'vendor/shared'), kind)

  const builder = new Builder()
  await builder.setup({ cwd: app })
  const parsed = vi.spyOn(builder.getContextOrThrow(), 'parseFile')
  builder.extract()
  const spelled = (path: string) => join(app, path).replaceAll('\\', '/')

  expect(builder.getSourceFiles(), 'the inventory has it by both').toEqual(
    expect.arrayContaining([spelled('src/shared/card.tsx'), spelled('vendor/shared/card.tsx')]),
  )
  expect(parsed.mock.calls.map(([file]) => String(file).replaceAll('\\', '/'))).toEqual([
    spelled('src/shared/card.tsx'),
  ])
  expect(builder.toCss().match(/color: var\(--colors-red-300\)/g)).toHaveLength(1)
})

// A link to a file, which no folder of the glob's names. Windows grants one only to an administrator.
test.skipIf(process.platform === 'win32')('knows a source that is a link to a file by where it really is', async () => {
  const app = join(root, 'file-link')
  mkdirSync(join(app, 'src'), { recursive: true })
  mkdirSync(join(root, 'library'), { recursive: true })
  writeFileSync(
    join(app, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.tsx'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(join(root, 'library/card.tsx'), `export const card = 'card'\n`)
  symlinkSync(join(root, 'library/card.tsx'), join(app, 'src/card.tsx'), 'file')

  const builder = new Builder()
  await builder.setup({ cwd: app })
  builder.extract()

  expect(builder.getRealSourceFiles()).toEqual([join(root, 'library/card.tsx')])
  expect(builder.toSourcePaths(join(root, 'library/card.tsx'))).toEqual([join(app, 'src/card.tsx')])
  expect(builder.isPotentialSourceFile(join(root, 'library/card.tsx'))).toBe(true)
})

/**
 * A pattern with no glob is looked up rather than walked, so it lists no folder: what it finds is
 * all there is to tell — a link to a file, here, or a file in a folder reached through a link.
 */
test.skipIf(process.platform === 'win32')('knows a source a pattern names exactly by where it really is', async () => {
  const project = join(root, 'linked-project')
  const app = join(root, 'linked-app')
  mkdirSync(join(project, 'src'), { recursive: true })
  mkdirSync(join(root, 'tokens'), { recursive: true })
  writeFileSync(
    join(project, 'bamboo.config.ts'),
    `export default { include: ['src/card.tsx', 'src/theme.ts'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(join(root, 'tokens/card.tsx'), `export const card = 'card'\n`)
  writeFileSync(join(project, 'src/theme.ts'), `export const theme = 'theme'\n`)
  symlinkSync(join(root, 'tokens/card.tsx'), join(project, 'src/card.tsx'), 'file')
  // The project itself through a link, as everything under `/tmp` is on macOS.
  symlinkSync(project, app, 'dir')

  const builder = new Builder()
  await builder.setup({ cwd: app })
  builder.extract()

  expect([...builder.getRealSourceFiles()].sort()).toEqual([
    join(project, 'src/theme.ts'),
    join(root, 'tokens/card.tsx'),
  ])
  expect(builder.toSourcePaths(join(root, 'tokens/card.tsx'))).toEqual([join(app, 'src/card.tsx')])
  expect(builder.toSourcePaths(join(project, 'src/theme.ts'))).toEqual([join(app, 'src/theme.ts')])

  // What is derived from the inventory stays with it: another glob of the same sources, as the
  // build's own checks take, does not stand in for the one behind it.
  const reals = builder.getRealSourceFiles()
  builder.getContextOrThrow().getFiles()
  expect(builder.getRealSourceFiles()).toBe(reals)
})
