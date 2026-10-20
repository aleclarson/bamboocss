import { createContext } from '@bamboocss/fixture'
import { bench, describe } from 'vitest'
import type { BambooContext } from '../src/create-context'

/**
 * Turning one file's native analysis into a parser result: `parseNativeFile`, the JavaScript half
 * of extraction, which every pass runs once per file it reads.
 *
 * The Rust analysis is taken once, outside the measurement — it is `native-extractor/analyze`'s to
 * measure, and it would bury this half — so what is timed is the walk over the calls the analysis
 * found and the encoder writes they make.
 *
 * `token()` calls are the unit under test: each is checked against the token table as it is read.
 * The control reads the same number of `css()` calls with their values written out, which holds
 * no `token()` call for that check to see.
 */
const ctx = createContext() as unknown as BambooContext

const analysisOf = (path: string, source: string) => {
  const file = ctx.runtime.path.abs(ctx.config.cwd, path)
  ctx.project.addSourceFile(file, source)
  ctx.prepareNativeExtraction([file])
  const native = (ctx as any).nativeExtractions.get(file.replaceAll('\\', '/'))
  if (!native?.calls.length) throw new Error(`no native analysis for ${path}`)
  return { file, native }
}

const tokenCalls = analysisOf(
  'src/token-calls.ts',
  `import { token } from 'styled-system/tokens'\n` +
    Array.from(
      { length: 500 },
      (_, i) => `export const t${i} = token('colors.${i % 2 ? 'red' : 'gray'}.${(i % 9) + 1}00')`,
    ).join('\n'),
)

const cssCalls = analysisOf(
  'src/css-calls.ts',
  `import { css } from 'styled-system/css'\n` +
    Array.from({ length: 500 }, (_, i) => `export const c${i} = css({ color: 'red.${(i % 9) + 1}00' })`).join('\n'),
)

const parseNativeFile = (ctx as any).parseNativeFile as (file: string, native: unknown, encoder: unknown) => unknown
const encoder = ctx.encoder.clone()

describe('parse file', () => {
  bench('500 token() calls', () => void parseNativeFile(tokenCalls.file, tokenCalls.native, encoder), {
    warmupIterations: 200,
    time: 1000,
  })

  bench('500 css() calls (control)', () => void parseNativeFile(cssCalls.file, cssCalls.native, encoder), {
    warmupIterations: 200,
    time: 1000,
  })
})
