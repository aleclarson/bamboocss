import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { LoadConfigResult } from '@bamboocss/types'
import { loadTsConfig } from '../src/load-tsconfig'

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'solution-mixed')

function mockConf(configPath: string, config: Partial<LoadConfigResult['config']> = {}): LoadConfigResult {
  return {
    path: configPath,
    config: config as LoadConfigResult['config'],
    serialized: '',
    deserialize: () => ({}) as LoadConfigResult['config'],
    dependencies: [],
    hooks: {},
  }
}

describe('loadTsConfig + TypeScript project references', () => {
  test('resolves to referenced tsconfig.src.json for sources under src/', async () => {
    const bambooPath = path.join(fixtureDir, 'src', 'bamboo.config.ts')
    const cwd = fixtureDir
    const result = await loadTsConfig(mockConf(bambooPath), cwd)

    expect(result?.tsconfigFile).toBe(path.join(fixtureDir, 'tsconfig.src.json'))
    expect(result?.tsconfig?.compilerOptions).toBeDefined()
  })

  test('falls back to root tsconfig when file is not in any referenced project', async () => {
    const bambooPath = path.join(fixtureDir, 'bamboo.config.ts')
    const cwd = fixtureDir
    const result = await loadTsConfig(mockConf(bambooPath), cwd)

    expect(result?.tsconfigFile).toBe(path.join(fixtureDir, 'tsconfig.json'))
  })

  /**
   * A config in none of the projects — beside a `"files": []` root, as `create vite` puts it —
   * resolved to the root, which declares no `paths`. The sources' aliases are in the project the
   * sources are in, and those are what extraction and the compiler resolve through.
   */
  test('takes the paths of the project including the sources', async () => {
    const bambooPath = path.join(fixtureDir, 'bamboo.config.ts')
    const cwd = fixtureDir
    const result = await loadTsConfig(mockConf(bambooPath, { include: ['./src/**/*.{ts,tsx}'] }), cwd)

    expect(result?.tsconfigFile).toBe(path.join(fixtureDir, 'tsconfig.src.json'))
    expect(result?.tsOptions?.pathMappings).toHaveLength(1)
  })
})
