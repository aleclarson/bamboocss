import { bench, describe } from 'vitest'
import { selectExtractable } from '../src/extractable-files'

/**
 * Which files a cold extraction pass parses, which had no benchmark.
 *
 * `selectExtractable` reads every source the inventory matched and resolves each local import it
 * names against the inventory, once per cold pass: 6,425 files took ~300ms on a real application.
 * The project here is held in memory, so what is measured is the scan and the path arithmetic, not
 * the disk. The control reads the same sources for an entrypoint and resolves no import, which is
 * the half of the pass no change to resolution touches — a reading that moves it moved the machine.
 */
const FILES = 3000
const ENTRYPOINTS = ['styled-system/css', 'styled-system/recipes', 'styled-system/patterns']

/** A hundred folders of 30: a tenth name `css`, and the rest import one of those, a shared module and a package. */
const sources = new Map<string, string>()
for (let index = 0; index < FILES; index++) {
  const folder = Math.floor(index / 30)
  const owner = index - (index % 10)
  sources.set(
    `/repo/src/feature-${folder}/component-${index}.tsx`,
    index % 10 === 0
      ? `import { css } from 'styled-system/css'\nexport const c${index} = css({ color: 'red.300' })\n`
      : `import { c${owner} } from './component-${owner}'\nimport { shared } from '../shared/util'\nimport React from 'react'\nexport const c${index} = [c${owner}, shared]\n`,
  )
}
sources.set('/repo/src/shared/util.ts', `export const shared = 1\n`)

const files = [...sources.keys()]
const options = {
  cwd: '/repo',
  entrypoints: ENTRYPOINTS,
  fileExists: (filePath: string) => sources.has(filePath),
  readFile: (filePath: string) => sources.get(filePath),
}
const benchOptions = { iterations: 20, warmupIterations: 5, time: 1000 }

describe('selectExtractable', () => {
  bench(
    `${FILES.toLocaleString('en')} files, a tenth naming an entrypoint`,
    () => {
      selectExtractable(files, options)
    },
    benchOptions,
  )

  bench(
    'control: every source read for an entrypoint',
    () => {
      let named = 0
      for (const file of files) {
        const text = options.readFile(file) ?? ''
        if (ENTRYPOINTS.some((entrypoint) => text.includes(entrypoint))) named++
      }
      if (named === 0) throw new Error('no source names an entrypoint')
    },
    benchOptions,
  )
})
