import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test, vi } from 'vitest'
import { logger } from '@bamboocss/logger'
import { parseTsconfig } from 'get-tsconfig'
import { isSourceFileIncludedInTsconfig, readTsconfigGraph } from '../src/tsconfig-utils'

describe('isSourceFileIncludedInTsconfig', () => {
  test('matches src/foo.ts against include "${configDir}/src/*"', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bamboo-tsconfig-match-'))
    try {
      writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          files: [],
          references: [{ path: './tsconfig.src.json' }],
        }),
      )
      writeFileSync(
        path.join(dir, 'tsconfig.src.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'ES2022',
            moduleResolution: 'bundler',
            skipLibCheck: true,
          },
          include: ['${configDir}/src/*'],
        }),
      )
      const src = path.join(dir, 'src')
      mkdirSync(src)
      writeFileSync(path.join(src, 'foo.ts'), 'export const x = 1\n')

      const childPath = path.join(dir, 'tsconfig.src.json')
      const parsed = parseTsconfig(childPath)
      const foo = path.join(dir, 'src', 'foo.ts')
      expect(isSourceFileIncludedInTsconfig(foo, childPath, parsed)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * A reference graph is read up to 256 tsconfigs, the root among them, and says so past that: a
 * solution reaching more is not one to walk on every config load.
 */
describe('readTsconfigGraph', () => {
  test('stops at 256 tsconfigs, and warns once for the root', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bamboo-tsconfig-cap-'))
    try {
      // A chain: each references the next, 300 deep.
      for (let index = 0; index < 300; index++) {
        writeFileSync(
          path.join(dir, `tsconfig.${index}.json`),
          JSON.stringify({ include: [], references: [{ path: `./tsconfig.${index + 1}.json` }] }),
        )
      }
      writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({ files: [], references: [{ path: './tsconfig.0.json' }] }),
      )
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

      const graph = await readTsconfigGraph(path.join(dir, 'tsconfig.json'))
      expect(graph.filter(() => true)).toHaveLength(255)
      await readTsconfigGraph(path.join(dir, 'tsconfig.json')).then((again) => again.filter(() => true))

      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
