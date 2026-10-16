import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext } from '@bamboocss/fixture'
import { bench, describe } from 'vitest'
import { foldSource } from '../src/fold'
import { createRuntimeCss } from '../src/runtime-css'
import { createStaticStyleSetCompiler } from '../src/style-set'

/**
 * What a build pays per module to fold it.
 *
 * This is the number that decides whether the transform can run in dev. In a bundler
 * `transform` hook it lands on every module, and again on every HMR update.
 *
 * `analyze only` is the control: the one native pass that parses the module and answers every
 * question the fold asks. `analyze + fold` adds the JavaScript half — class allocation, recipe
 * tables, `cx` composition and the rewrite — so the gap between the two is what the fold costs.
 *
 * Reported, not asserted, like the rest of the benches here: wall-clock is
 * machine-dependent, and a threshold would fail on a busy runner rather than on a
 * regression.
 */
const here = dirname(fileURLToPath(import.meta.url))
const sandbox = join(here, '../../../sandbox/vite-ts/src')

const readSandbox = (file: string) => {
  try {
    return readFileSync(join(sandbox, file), 'utf8')
  } catch {
    return null
  }
}

const SANDBOX_FILES = ['App.tsx', 'Card.tsx', 'Badge.tsx', 'Button.tsx']
  .map((file) => ({ file, code: readSandbox(file) }))
  .filter((entry): entry is { file: string; code: string } => entry.code != null)

const SYNTHETIC = `
import { css } from 'styled-system/css'
import { stack } from 'styled-system/patterns'

export const a = css({ color: 'red.300', padding: '4' })
export const b = css({ display: 'flex', _hover: { color: 'blue.500' } })
export const c = css({ fontSize: { base: 'sm', md: 'lg' } })
export const d = stack({ gap: '4', align: 'center' })
export function dynamic(tone: string) {
  return css({ color: tone })
}
`

/**
 * A module saturated with choices, which nothing else here is — between the synthetic
 * module and the four sandbox files there are two lines holding a `?` or a `||`.
 *
 * Auditing a choice means re-boxing both of its arms, which is the one place this
 * transform does work proportional to something other than the number of call sites. A
 * module of nothing but conditionals is not realistic; it is the upper bound, which is
 * what makes a regression visible here before it is visible anywhere else.
 */
const CONDITIONAL_MODULE = `
import { css } from 'styled-system/css'

const on = true
const tint = 'red.300'

${Array.from(
  { length: 8 },
  (_, index) => `
export const lowered${index} = (e: boolean) => css({ margin: '${index % 8}', color: e ? 'red.300' : 'blue.500' })
export const decided${index} = css({ padding: '${index % 8}', color: on ? tint : 'blue.500' })
export const guessed${index} = (e: boolean) => css({ padding: '${index % 8}', color: e ? 'red.300' : fn() })
`,
).join('')}
`

/**
 * A call-heavy module, which the sandbox files above barely are — between them they hold
 * only a handful of call sites.
 *
 * A component file is where `css()` calls come in bulk, so this is the shape that shows
 * what folding one costs when there are many.
 */
const JSX_MODULE = `
import { css } from 'styled-system/css'
import { center, hstack, stack } from 'styled-system/patterns'

export const View = ({ tone, rest }) => (
  <div className={css({ padding: '4', backgroundColor: 'gray.100' })}>
    ${Array.from(
      { length: 12 },
      (_, i) => `<span className={css({ color: 'blue.500', fontWeight: 'bold' })} id="s${i}">plain ${i}</span>`,
    ).join('\n    ')}
    <div className={css({ color: 'gray.800', _hover: { color: 'red.300' }, fontSize: { base: 'sm', md: 'lg' } })}>conditions</div>
    <section className={css({ color: 'red.300' })}>as</section>
    <div className={css({ color: tone })}>dynamic</div>
    <div className={css({ color: 'green.300', ...rest })}>spread</div>
    <div className={stack({ gap: '4' })}>
      <div className={center({ padding: '2', backgroundColor: 'white' })}>center</div>
      <div className={hstack({ gap: '1', color: 'gray.700' })}>hstack</div>
    </div>
  </div>
)
`

/**
 * A module of inline recipes, which nothing else here has.
 *
 * This is the one shape whose cost is not proportional to call sites alone: the fold builds a
 * binding→config map once per module, then derives class names per call — hashing the recipe's
 * identity once per recipe and walking its variants once per dynamic axis. A component file
 * that declares a recipe and calls it a few times is the realistic shape; the definitions are
 * what make it different from `JSX_MODULE`.
 */
const RECIPE_MODULE = `
import { cva } from 'styled-system/css'

${Array.from(
  { length: 6 },
  (_, index) => `
const recipe${index} = cva({
  base: { display: 'flex', padding: '${index % 4}' },
  variants: {
    tone: { info: { color: 'blue.500' }, warn: { color: 'red.300' }, muted: { color: 'gray.500' } },
    size: { sm: { fontSize: 'sm' }, md: { fontSize: 'md' }, lg: { fontSize: 'lg' } },
  },
  defaultVariants: { size: 'md' },
})
export const static${index} = recipe${index}({ tone: 'info', size: 'sm' })
export const dynamic${index} = (tone) => recipe${index}({ tone })
export const mixed${index} = (tone) => recipe${index}({ tone, size: 'lg' })
`,
).join('')}
`

/**
 * A module whose styles come from helpers the evaluator has to call, which nothing else here
 * does — the others call only `css` and patterns, which are not run — and the same styles
 * written out, as its control.
 *
 * Every helper call goes through the guard that refuses a recursion the build cannot see the end
 * of: it compares the call with those of the same helper already running before following it. So
 * it costs per call, and more the deeper a recursion runs. `layer` passes a theme down sixteen
 * levels, and only the arguments' fingerprint keeps that theme from being compared in full at
 * every level, against every level above it. The gap between the two is what calling the helpers
 * costs, the guard included.
 */
const TONES = ['red.300', 'blue.500', 'gray.700']
const LAYERS = 16

const HELPER_MODULE = `
import { css } from 'styled-system/css'

const theme = { space: { sm: '1', md: '2', lg: '4' }, tone: { info: 'blue.500', warn: 'red.300' } }
const space = (step) => ({ padding: step, margin: step })
const tone = (color, strong) => ({ color, fontWeight: strong ? 'bold' : 'normal' })
const card = (color, step) => ({ ...space(step), ...tone(color, true), borderRadius: 'md' })
const layer = (t, depth) => (depth > 0 ? { '& > div': layer(t, depth - 1), padding: t.space.md } : { color: t.tone.info })

${Array.from(
  { length: 12 },
  (_, index) => `
export const card${index} = css(card('${TONES[index % 3]}', '${index % 4}'))
export const layered${index} = css(layer(theme, ${LAYERS}))
`,
).join('')}
`

/**
 * Helpers given their arguments by a spread, which nothing else here is: of an array the build knows,
 * passed element by element, of a rest parameter passed on, and of a value it does not know, padded
 * so no parameter after it is taken for `undefined`.
 */
const SPREAD_MODULE = `
import { css } from 'styled-system/css'

const box = (padding, margin, color) => ({ padding, margin, color })
const merge = (...styles) => Object.assign({}, ...styles)
const steps = ['1', '2', 'red.300']

${Array.from(
  { length: 12 },
  (_, index) => `
export const known${index} = css(box(...steps))
export const merged${index} = css(merge({ padding: '${index % 4}' }, { color: '${TONES[index % 3]}' }))
export const open${index} = (props) => css(box(...props.steps))
`,
).join('')}
`

const layered = (depth: number): string =>
  depth > 0 ? `{ '& > div': ${layered(depth - 1)}, padding: '2' }` : `{ color: 'blue.500' }`

const WRITTEN_OUT_MODULE = `
import { css } from 'styled-system/css'

${Array.from(
  { length: 12 },
  (_, index) => `
export const card${index} = css({ padding: '${index % 4}', margin: '${index % 4}', color: '${TONES[index % 3]}', fontWeight: 'bold', borderRadius: 'md' })
export const layered${index} = css(${layered(LAYERS)})
`,
).join('')}
`

const ctx = createContext()
const runtimeCss = createRuntimeCss(ctx)
const styleCompiler = createStaticStyleSetCompiler(ctx, runtimeCss)

let counter = 0
/** A fresh path per iteration, so nothing is served from a per-file cache. */
const nextPath = () => join(ctx.config.cwd, `app/src/bench-${counter++}.tsx`)

const analyze = (code: string, filePath = nextPath()) =>
  ctx.compileModules([{ filename: filePath, source: code }], { references: true })[0]!

const parseOnly = (code: string) => analyze(code)

const parseAndFold = (code: string) => {
  const filePath = nextPath()
  return foldSource({ ctx, code, analysis: analyze(code, filePath), filePath, styleCompiler, reportSurvivors: true })
}

/**
 * The fold with no class name cached: a fresh compiler for every module.
 *
 * Every other case shares one compiler across iterations, so after the first its names come out
 * of the memo — the warm path of a long dev session. A cold build, a dev server's first visit to
 * a module and a style just edited name from scratch, and that is where checking each
 * declaration's path for a key that is not a condition is paid.
 */
const parseAndFoldCold = (code: string) => {
  const filePath = nextPath()
  const cold = createStaticStyleSetCompiler(ctx, createRuntimeCss(ctx))
  return foldSource({
    ctx,
    code,
    analysis: analyze(code, filePath),
    filePath,
    styleCompiler: cold,
    reportSurvivors: true,
  })
}

describe('per-module transform cost', () => {
  bench('analyze only (synthetic module)', () => {
    parseOnly(SYNTHETIC)
  })

  bench('analyze + fold (synthetic module)', () => {
    parseAndFold(SYNTHETIC)
  })

  // `time` raised past the 500ms default: at the default this reports a dozen samples,
  // and a dozen samples cannot resolve the effect sizes it exists to catch — two runs of
  // an unchanged tree disagreed by 7%.
  bench(
    'analyze + fold (conditional module)',
    () => {
      parseAndFold(CONDITIONAL_MODULE)
    },
    { warmupIterations: 3, time: 3000 },
  )

  bench('analyze only (jsx module)', () => {
    parseOnly(JSX_MODULE)
  })

  bench('analyze + fold (jsx module)', () => {
    parseAndFold(JSX_MODULE)
  })

  bench('analyze + fold, names cold (jsx module)', () => {
    parseAndFoldCold(JSX_MODULE)
  })

  // The control for the pair below: analysis dominates, so a change to the recipe path shows
  // up as the gap between these two rather than in either alone.
  bench('analyze only (recipe module)', () => {
    parseOnly(RECIPE_MODULE)
  })

  bench('analyze + fold (recipe module)', () => {
    parseAndFold(RECIPE_MODULE)
  })

  bench('analyze + fold, names cold (recipe module)', () => {
    parseAndFoldCold(RECIPE_MODULE)
  })

  // The control for the one below: the same styles, with no helper to call.
  bench('analyze only (helper module, written out)', () => {
    parseOnly(WRITTEN_OUT_MODULE)
  })

  bench('analyze only (helper module)', () => {
    parseOnly(HELPER_MODULE)
  })

  // Read against the helper module above: helpers of the same kind, given their arguments by a
  // spread.
  bench('analyze only (spread arguments module)', () => {
    parseOnly(SPREAD_MODULE)
  })

  for (const { file, code } of SANDBOX_FILES) {
    bench(`analyze + fold (sandbox/vite-ts ${file})`, () => {
      parseAndFold(code)
    })
  }
})
