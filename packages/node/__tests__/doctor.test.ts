// @vitest-environment node
// Loads a config from a temporary project, which needs `file:` URLs as Node has them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { codegen } from '../src/codegen'
import { loadConfigAndCreateContext } from '../src/config'
import { doctor, formatDoctorReport } from '../src/doctor'

/**
 * `bamboo doctor`: the project as the build reads it, and what stops the build doing what it is
 * asked — a generated `styled-system` out of step with the config, a source the extractor cannot
 * read, a call naming nothing.
 */
const projects: string[] = []
afterEach(() => {
  for (const cwd of projects.splice(0)) rmSync(cwd, { recursive: true, force: true })
})

const project = (sources: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-doctor-'))
  projects.push(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.mjs'),
    `export default { include: ['src/**/*.tsx'], outdir: 'styled-system' }\n`,
  )
  for (const [file, code] of Object.entries(sources)) writeFileSync(join(cwd, 'src', file), code)
  return cwd
}

const app = `import { css } from '../styled-system/css'\nexport const a = css({ color: 'red.300' })\n`

describe('bamboo doctor', () => {
  test('says the generated files are missing before codegen', async () => {
    const report = await doctor(await loadConfigAndCreateContext({ cwd: project({ 'app.tsx': app }) }))

    expect(report.sources).toBe(1)
    expect(report.artifacts.files).toBeGreaterThan(0)
    expect(report.artifacts.missing).toHaveLength(report.artifacts.files)
    expect(report.problems).toEqual([expect.stringMatching(/missing: run `bamboo codegen`\.$/)])
  }, 60_000)

  test('finds nothing to fix after codegen, and says so', async () => {
    const cwd = project({ 'app.tsx': app })
    await codegen(await loadConfigAndCreateContext({ cwd }))
    const report = await doctor(await loadConfigAndCreateContext({ cwd }))

    expect(report).toMatchObject({ problems: [], unextracted: [], deadCalls: [] })
    expect(report.artifacts).toMatchObject({ missing: [], stale: [] })
    expect(formatDoctorReport(report)).toMatch(/No problems found\.$/)
  }, 60_000)

  test('says what is out of date, what could not be extracted, and what calls nothing', async () => {
    const cwd = project({
      'app.tsx': app,
      // A source that reaches an entrypoint, as only those are read.
      'broken.tsx': `import { css } from '../styled-system/css'\nexport const = css(\n`,
      'gone.tsx': `import { nothing } from '../styled-system/patterns'\nexport const b = nothing({})\n`,
    })
    await codegen(await loadConfigAndCreateContext({ cwd }))
    writeFileSync(join(cwd, 'styled-system/css/css.mjs'), '// edited by hand\n')

    const report = await doctor(await loadConfigAndCreateContext({ cwd }))

    expect(report.artifacts.stale).toEqual([join('css', 'css.mjs')])
    expect(report.unextracted.map(({ file }) => file)).toEqual([join('src', 'broken.tsx')])
    expect(report.deadCalls).toEqual([`${join('src', 'gone.tsx')}: nothing`])
    expect(report.problems).toHaveLength(3)
    expect(formatDoctorReport(report)).toContain('out of date\n  css/css.mjs')
  }, 60_000)

  // Codegen removes it; until then it resolves, and answers with class names for rules that are gone.
  test('says what is generated no longer', async () => {
    const cwd = project({ 'app.tsx': app })
    await codegen(await loadConfigAndCreateContext({ cwd }))
    writeFileSync(join(cwd, 'styled-system/patterns/gone.mjs'), 'export const gone = () => ""\n')

    const report = await doctor(await loadConfigAndCreateContext({ cwd }))

    expect(report.artifacts.leftover).toEqual([join('patterns', 'gone.mjs')])
    expect(report.problems).toEqual([expect.stringContaining('1 no longer generated: run `bamboo codegen`')])
  }, 60_000)

  // The native extractor failing to load is no finding about the project, and saying there was
  // nothing wrong would be one.
  test('fails, rather than reporting nothing wrong, when the extraction cannot run at all', async () => {
    const ctx = await loadConfigAndCreateContext({ cwd: project({ 'app.tsx': app }) })
    ctx.parseFiles = () => {
      throw new Error('Failed to load the native extractor binary')
    }
    await expect(doctor(ctx)).rejects.toThrow('Failed to load the native extractor binary')
  }, 60_000)
})
