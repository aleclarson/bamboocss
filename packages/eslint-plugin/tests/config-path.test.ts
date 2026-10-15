import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { configFor } from '../src/utils/config-path'

/**
 * Which config the rules read. `@bamboocss/configPath` was only where the search for a
 * `bamboo.config.*` began, so a config by another name was never read and the search went on to
 * whichever one was above it.
 */
const root = mkdtempSync(join(tmpdir(), 'bamboo-eslint-config-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

mkdirSync(join(root, 'app/src'), { recursive: true })
mkdirSync(join(root, 'configs'), { recursive: true })
writeFileSync(join(root, 'bamboo.config.ts'), 'export default {}')
writeFileSync(join(root, 'app/bamboo.config.ts'), 'export default {}')
writeFileSync(join(root, 'configs/bamboo.dev.ts'), 'export default {}')

describe('the config the rules read', () => {
  test('is the one found from the file being linted', () => {
    expect(configFor({ currentFile: join(root, 'app/src/button.tsx') })).toBe(join(root, 'app/bamboo.config.ts'))
  })

  test('is the file the setting names, whatever it is called', () => {
    expect(
      configFor({ configPath: join(root, 'configs/bamboo.dev.ts'), currentFile: join(root, 'app/src/button.tsx') }),
    ).toBe(join(root, 'configs/bamboo.dev.ts'))
  })

  test('is the one found from a directory the setting names', () => {
    expect(configFor({ configPath: join(root, 'app'), currentFile: join(root, 'other.tsx') })).toBe(
      join(root, 'app/bamboo.config.ts'),
    )
  })

  // Relative to ESLint's working directory, not the process's: an editor runs ESLint in the
  // workspace folder.
  test('is read relative to where ESLint runs', () => {
    expect(configFor({ configPath: './configs/bamboo.dev.ts', currentFile: 'button.tsx', cwd: root })).toBe(
      join(root, 'configs/bamboo.dev.ts'),
    )
  })

  // Not the root's, which a search from the directory would go on to.
  test('is not one above a directory the setting names', () => {
    expect(() => configFor({ configPath: join(root, 'configs'), currentFile: 'button.tsx' })).toThrow(
      /`@bamboocss\/configPath` names .*configs, which holds no `bamboo\.config\.\*`/,
    )
  })

  test('is not one that does not exist', () => {
    expect(() => configFor({ configPath: './bamboo.confg.ts', currentFile: 'button.tsx', cwd: root })).toThrow(
      /`@bamboocss\/configPath` names .*bamboo\.confg\.ts, which does not exist/,
    )
  })
})
