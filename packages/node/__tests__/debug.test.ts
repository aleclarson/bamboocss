import { createContext } from '@bamboocss/fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { debug } from '../src/debug'

afterEach(() => {
  vi.restoreAllMocks()
})

// It ended in a count of the files it had written, with nothing on disk.
test('fails when a debug file cannot be written', async () => {
  const outdir = mkdtempSync(join(tmpdir(), 'bamboo-debug-'))
  try {
    const ctx = createContext() as any
    ctx.project.addSourceFile(
      'app.tsx',
      `import { css } from 'styled-system/css'\nexport const a = css({ color: 'red' })\n`,
    )
    ctx.getFiles = () => ['app.tsx']
    vi.spyOn(ctx.runtime.fs, 'writeFile').mockRejectedValue(new Error('EROFS: read-only file system'))

    await expect(debug(ctx, { outdir, dry: false })).rejects.toThrow(/could not be written.*EROFS/)
  } finally {
    rmSync(outdir, { recursive: true, force: true })
  }
})
