import { createContext } from '@bamboocss/fixture'
import { bench, describe } from 'vitest'

/**
 * What the unresolved-token check costs, in the two places it runs.
 *
 * `transform` asks it of every value as the decoder first meets it, and the error pass asks it
 * again of every atom in the sheet each time one is emitted — which a dev server does on every
 * edit, and which runs by default, since the token half defaults to `error`.
 *
 * Each measurement has a context of its own and every value is valid, so neither records a
 * finding the other then reads. Each control reads the same structure without asking anything.
 */
const transformCtx = createContext({}) as any
const sheetCtx = createContext({}) as any

const pairs: Array<[string, string]> = [
  ['color', 'red.300'],
  ['background', 'blue.500'],
  ['border', '1px solid token(colors.red.300)'],
  ['padding', '4'],
  ['display', 'flex'],
  ['alignItems', 'center'],
  ['borderColor', 'gray.100'],
  ['fill', '#fff'],
  ['fontSize', 'sm'],
  ['outlineColor', 'token(colors.blue.500)'],
]

// 66 atoms, 36 of them holding a `token()` reference.
const styles = Array.from({ length: 400 }, (_, i) => ({
  display: 'flex',
  alignItems: 'center',
  gap: String(i % 8),
  paddingX: String((i % 5) + 1),
  color: i % 2 ? 'red.300' : 'blue.500',
  border: `${(i % 4) + 1}px solid token(colors.gray.${(i % 9) + 1}00)`,
  fontSize: i % 3 ? 'sm' : 'lg',
  _hover: { color: 'gray.700', bg: i % 4 ? 'gray.100' : 'white' },
  md: { gap: String((i % 6) + 2), flexDirection: i % 2 ? 'row' : 'column' },
}))
for (const style of styles) sheetCtx.encoder.processAtomic(style)
sheetCtx.decoder.collect(sheetCtx.encoder)

// Kept so the control's reads are not optimized away.
let sink = 0

describe('unresolved tokens', () => {
  bench(
    'transform x100',
    () => {
      for (let i = 0; i < 100; i++) transformCtx.utility.transform(...pairs[i % 10])
    },
    { warmupIterations: 200, time: 1000 },
  )

  bench(
    'resolveShorthand x100 (control)',
    () => {
      for (let i = 0; i < 100; i++) transformCtx.utility.resolveShorthand(pairs[i % 10][0])
    },
    { warmupIterations: 200, time: 1000 },
  )

  bench('the error pass over the sheet', () => sheetCtx.assertNoUnresolvedTokens(), {
    warmupIterations: 50,
    time: 1000,
  })

  bench(
    'reading every atom (control)',
    () => {
      for (const atom of sheetCtx.decoder.atomic) sink += String(atom.entry.prop).length
    },
    { warmupIterations: 50, time: 1000 },
  )
})
