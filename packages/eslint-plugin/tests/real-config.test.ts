import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * The built plugin against a real `bamboo.config.ts`, as a project lints with it: in a process of
 * its own, since every test here otherwise reads the fixture context `BAMBOO_ESLINT_TEST_CONTEXT`
 * names, and from another directory than the project's, as from a monorepo's root.
 */
const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

const project = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-eslint-real-'))
  directories.push(cwd)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  return cwd
}

const config = `export default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system' }`
const app = `import { css } from '../styled-system/css'\nexport const tone = (color: string) => css({ color, debug: true })\n`

/**
 * Lint `src/app.tsx` once per entry of `steps`, in one process: a step's files are written first,
 * with an mtime later than the last, as an edit between two lints would leave them.
 */
const lint = (cwd: string, steps: Array<Record<string, string>> = [{}], env: Record<string, string> = {}) => {
  const script = `
    const { ESLint } = require('eslint')
    const { utimesSync, writeFileSync } = require('node:fs')
    const tsParser = require('@typescript-eslint/parser')
    const bamboo = require('./dist/index.cjs')
    const eslint = new ESLint({
      cwd: ${JSON.stringify(cwd)},
      overrideConfigFile: true,
      overrideConfig: [{ files: ['**/*.tsx'], languageOptions: { parser: tsParser } }, bamboo.configs['flat/recommended']],
    })
    ;(async () => {
      const results = []
      for (const [index, files] of ${JSON.stringify(steps)}.entries()) {
        for (const [file, contents] of Object.entries(files)) {
          const target = ${JSON.stringify(cwd)} + '/' + file
          writeFileSync(target, contents)
          utimesSync(target, Date.now() / 1000 + index + 1, Date.now() / 1000 + index + 1)
        }
        const [result] = await eslint.lintFiles(['src/app.tsx'])
        results.push(result.messages.map((m) => [m.ruleId, m.line, m.column]))
      }
      process.stdout.write(JSON.stringify(results))
    })()
  `
  const { BAMBOO_ESLINT_TEST_CONTEXT: _, ...inherited } = process.env
  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: { ...inherited, ...env },
  })
  // Nothing but the result: the build's warnings are the diagnostics here, not console lines.
  return JSON.parse(stdout) as Array<Array<[string, number, number]>>
}

const rules = (messages: Array<[string, number, number]>) => messages.map(([rule]) => rule)

describe('a real config', { timeout: 60_000 }, () => {
  // `include` used to be matched from wherever ESLint ran, so from there every file of the
  // project was outside it: `file-not-included` on each, and nothing else checked.
  test('is read from its own directory, wherever ESLint runs', () => {
    const cwd = project({ 'bamboo.config.ts': config, 'src/app.tsx': app })

    const [messages] = lint(cwd)

    expect(messages).toContainEqual(['bamboo/no-unresolved-styles', 2, 40])
    expect(rules(messages!)).toContain('bamboo/no-debug')
    expect(rules(messages!)).not.toContain('bamboo/file-not-included')
  })

  // A filter lifts the logger to `debug` for what it matches, which a level alone does not stop.
  test('logs nothing into ESLint’s output, with the debug log on', () => {
    const cwd = project({ 'bamboo.config.ts': config, 'src/app.tsx': app })

    expect(rules(lint(cwd, [{}], { BAMBOO_DEBUG: 'file:*' })[0]!)).toContain('bamboo/no-unresolved-styles')
  })

  // What the build's preparation refuses, the generator alone does not need: the rules reading
  // only the config go on, and the extraction stands aside.
  test('that the build cannot prepare still answers the rules that read only it', () => {
    const cwd = project({
      'bamboo.config.ts': config,
      'src/app.tsx': app,
      'tsconfig.json': JSON.stringify({ extends: './missing.json' }),
    })

    const [messages] = lint(cwd)

    expect(rules(messages!)).toContain('bamboo/no-debug')
    expect(rules(messages!)).not.toContain('bamboo/no-unresolved-styles')
  })

  // A config that fails to load is loaded again once it changes — not on every lint, and not
  // never.
  test('that fails to load is loaded again once it is fixed', () => {
    const cwd = project({ 'bamboo.config.ts': `throw new Error('mid-edit')`, 'src/app.tsx': app })

    const [broken, fixed] = lint(cwd, [{}, { 'bamboo.config.ts': config }])

    expect(rules(broken!)).not.toContain('bamboo/no-debug')
    expect(rules(fixed!)).toContain('bamboo/no-debug')
  })
})
