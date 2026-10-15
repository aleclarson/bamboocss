import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { loadConfigAndCreateContext } from '../src/config'
import { loadTsConfig } from '../src/load-tsconfig'

/**
 * A source importing through an alias only a referenced project declares — `create vite`'s
 * `tsconfig.app.json`, under a `"files": []` root.
 *
 * The aliases were taken from the project the config file is in, and the config file, beside the
 * root or in `tsconfig.node.json`, is in a project declaring none. So the import resolved nowhere,
 * and the value it brought in never reached the sheet.
 */
const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

const project = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-solution-paths-'))
  directories.push(cwd)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  return cwd
}

const sheetFor = async (cwd: string) => {
  const ctx = await loadConfigAndCreateContext({ cwd })
  ctx.parseFile(join(cwd, 'src/app.tsx'))
  const sheet = ctx.createSheet()
  ctx.appendParserCss(sheet)
  return ctx.getCss(sheet)
}

const app = {
  'tsconfig.app.json': JSON.stringify({ include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
  'bamboo.config.ts': `export default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system' }`,
  'src/tone.ts': `export const tone = 'red.300'`,
  'src/app.tsx': `import { css } from '../styled-system/css'\nimport { tone } from '@/tone'\nexport const a = css({ color: tone })\n`,
}

describe("a source's alias resolves through the project the sources are in", () => {
  test('with the config beside the root, in no project', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
      ...app,
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  test('with the config in a project declaring no aliases', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
      }),
      'tsconfig.node.json': JSON.stringify({ include: ['bamboo.config.ts'] }),
      ...app,
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  // The sources are what these resolve, so their project's aliases, not the config's.
  test('with the config in a project declaring aliases of its own', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }],
      }),
      'tsconfig.node.json': JSON.stringify({
        include: ['bamboo.config.ts'],
        compilerOptions: { paths: { '~/*': ['./config/*'] } },
      }),
      ...app,
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  // A glob reaching the root's directory reaches `tsconfig.node.json`'s `*.ts` there, and the
  // sources are in `tsconfig.app.json` all the same.
  test('with an include reaching a project declaring no aliases first', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }],
      }),
      'tsconfig.node.json': JSON.stringify({ include: ['*.ts'] }),
      ...app,
      'bamboo.config.ts': `export default { preflight: false, include: ['./**/*.tsx'], outdir: 'styled-system' }`,
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  // An include naming files rather than a directory is as much the sources' project.
  test('with the sources listed one by one, and the config in a project with a baseUrl', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }],
      }),
      'tsconfig.node.json': JSON.stringify({ include: ['bamboo.config.ts'], compilerOptions: { baseUrl: '.' } }),
      ...app,
      'tsconfig.app.json': JSON.stringify({
        include: ['src/app.tsx', 'src/tone.ts'],
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  // shadcn's Vite setup puts the aliases in the root, beside `"files": []`.
  test('with the aliases in the root, and none in the project', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      }),
      ...app,
      'tsconfig.app.json': JSON.stringify({ include: ['src'] }),
    })

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })

  // `baseUrl`, and `paths` without one, resolve against the tsconfig declaring them, not the root.
  test.each([
    ['without a baseUrl', { paths: { '@/*': ['./src/*'] } }],
    ['with a baseUrl', { baseUrl: '.', paths: { '@/*': ['src/*'] } }],
  ])('with the sources in a project of their own directory, %s', async (_, compilerOptions) => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './web/tsconfig.app.json' }] }),
      'web/tsconfig.app.json': JSON.stringify({ include: ['src'], compilerOptions }),
      'bamboo.config.ts': `export default { preflight: false, include: ['web/src/**/*.tsx'], outdir: 'styled-system' }`,
      'web/src/tone.ts': `export const tone = 'red.300'`,
      'web/src/app.tsx': `import { css } from '../../styled-system/css'\nimport { tone } from '@/tone'\nexport const a = css({ color: tone })\n`,
    })
    const ctx = await loadConfigAndCreateContext({ cwd })
    ctx.parseFile(join(cwd, 'web/src/app.tsx'))
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)

    expect(ctx.getCss(sheet)).toContain('color: var(--colors-red-300)')
  })
})

// Another project declaring aliases and reaching where `include` points without including the
// sources — excluding them, taking only tests, listing one other file — is not the sources'. Nor
// when the sources' own project lists its files one by one, and so includes no file standing for them.
const listed = ['src/app.tsx', 'src/tone.ts']
test.each([
  [
    'excludes them',
    { include: ['**/*.ts'], exclude: ['src'], compilerOptions: { paths: { '@/*': ['./scripts/*'] } } },
    ['./src/**/*.tsx'],
    ['src'],
  ],
  [
    'excludes them, beside a project listing its files',
    { include: ['**/*.ts'], exclude: ['src'], compilerOptions: { paths: { '@/*': ['./scripts/*'] } } },
    ['./src/**/*.tsx'],
    listed,
  ],
  [
    'takes only the tests among them',
    { include: ['src/**/*.test.ts'], compilerOptions: { paths: { '@/*': ['./test/mocks/*'] } } },
    ['./src/**/*.tsx'],
    ['src'],
  ],
  [
    'lists another file beside them',
    { files: ['src/sw.ts'], compilerOptions: { paths: { '@/*': ['./worker/*'] } } },
    ['./src/app.tsx'],
    ['src'],
  ],
  [
    'is reached only by a negation',
    { include: ['scripts'], compilerOptions: { paths: { '@/*': ['./scripts/*'] } } },
    ['./src/**/*.tsx', '!./src/legacy/**'],
    listed,
  ],
])('the sources resolve past a project listed first that %s', async (_, other, include, appInclude) => {
  const cwd = project({
    'tsconfig.json': JSON.stringify({
      files: [],
      references: [{ path: './tsconfig.other.json' }, { path: './tsconfig.app.json' }],
    }),
    'tsconfig.other.json': JSON.stringify(other),
    ...app,
    'tsconfig.app.json': JSON.stringify({ include: appInclude, compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'bamboo.config.ts': `export default { preflight: false, include: ${JSON.stringify(include)}, outdir: 'styled-system' }`,
  })

  expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
})

// The sources' project declaring no aliases is the sources having none — not another project's.
test("a project including the sources and declaring no aliases lends none of another's", async () => {
  const cwd = project({
    'tsconfig.json': JSON.stringify({
      files: [],
      references: [{ path: './web/tsconfig.json' }, { path: './ui/tsconfig.json' }],
    }),
    'web/tsconfig.json': JSON.stringify({ include: ['src'] }),
    'ui/tsconfig.json': JSON.stringify({ include: ['src'], compilerOptions: { baseUrl: '.' } }),
    'bamboo.config.ts': `export default { preflight: false, include: ['web/src/**/*.tsx'], outdir: 'styled-system' }`,
    'web/src/app.tsx': `export const a = 1\n`,
  })
  const ctx = await loadConfigAndCreateContext({ cwd })

  expect(ctx.conf.tsconfig?.compilerOptions?.baseUrl).toBeUndefined()
  expect(ctx.conf.tsOptions).toBeUndefined()
})

describe('a root that is not solution-style', () => {
  // It compiles the sources itself; a project it references for something else is not theirs.
  test("keeps its own options, and none of a referenced library's aliases", async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({ include: ['src'], references: [{ path: './lib' }] }),
      'lib/tsconfig.json': JSON.stringify({ include: ['.'], compilerOptions: { paths: { '@/*': ['./elsewhere/*'] } } }),
      ...app,
    })
    const ctx = await loadConfigAndCreateContext({ cwd })

    expect(ctx.conf.tsconfigFile).toBe(join(cwd, 'tsconfig.json'))
    expect(ctx.conf.tsOptions?.pathMappings).toBeUndefined()
  })

  // A JavaScript config resolves the sources through the root, whichever project includes it.
  test('keeps its aliases for a JavaScript config a referenced project includes', async () => {
    const cwd = project({
      'tsconfig.json': JSON.stringify({
        include: ['src'],
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
        references: [{ path: './tsconfig.node.json' }],
      }),
      'tsconfig.node.json': JSON.stringify({ include: ['bamboo.config.cjs'], compilerOptions: { allowJs: true } }),
      ...app,
      'tsconfig.app.json': '{}',
      'bamboo.config.cjs': `module.exports = { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system' }`,
    })
    rmSync(join(cwd, 'bamboo.config.ts'))

    expect(await sheetFor(cwd)).toContain('color: var(--colors-red-300)')
  })
})

// The dev server reloads when a file it recorded changes, and a reference not there yet is one.
test('a referenced project that does not exist yet is recorded', async () => {
  const cwd = project({
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
    'bamboo.config.ts': app['bamboo.config.ts'],
    'src/app.tsx': `export const a = 1\n`,
  })
  const resolutionFiles: { value?: readonly string[] } = {}
  const ctx = await loadConfigAndCreateContext({ cwd })
  await loadTsConfig(ctx.conf, cwd, resolutionFiles)

  expect(resolutionFiles.value).toContain(join(cwd, 'tsconfig.app.json'))
})
