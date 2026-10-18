import { esc } from '@bamboocss/shared'
import { bench, describe } from 'vitest'
import { bamboocssCssEarly } from '../src/css'
import { pruneStaticCss } from '../src/css-output-module'
import { createStaticCompilationSession } from '../src/static-session'

/**
 * What the early output pass costs an output, which had no benchmark: once per output rather than
 * per module, but on the path every build ends in, and every round of a watch.
 *
 * A sheet of 3,000 atoms a third of which nothing reaches, as an environment writing it prunes it
 * and as a server environment, whose copy Vite discards, does. `prune only` is the control: the
 * parse and prune the pass is built around, which neither naming nor splitting touches — a reading
 * that moves it moved the machine.
 */
const ATOMS = 3000
const atoms = Array.from({ length: ATOMS }, (_, index) => `w_[${index}.5px]`)
const SHEET =
  `@layer reset, base, tokens, utilities;` +
  `@layer utilities{${atoms.map((atom, index) => `.${esc(atom)}{width:${index}.5px}`).join('')}}` +
  `:root{--made-with-bamboo:🌱}`
const ORIGINAL = 'assets/index.css'

const session = createStaticCompilationSession()
for (const atom of atoms) session.prunableClasses.add(esc(atom))
for (const atom of atoms.slice(0, 2000)) session.markClassUsed(atom)
const requiredClasses = new Set([...session.usedClasses])

const generate = bamboocssCssEarly({ session, pruneCss: true }).generateBundle as {
  handler: (this: unknown, outputOptions: object, bundle: object, isWrite: boolean) => Promise<void>
}
const environments = {
  client: { name: 'client', config: { consumer: 'client', build: { emitAssets: true } } },
  ssr: { name: 'ssr', config: { consumer: 'server', build: { ssr: true, emitAssets: false } } },
}
/** A fresh bundle and output each time: the pass renames the asset in place, and remembers both. */
const pass = (environment: (typeof environments)[keyof typeof environments]) =>
  generate.handler.call(
    { environment },
    {},
    {
      [ORIGINAL]: { type: 'asset', fileName: ORIGINAL, names: [], source: SHEET },
      'entry.js': {
        type: 'chunk',
        fileName: 'entry.js',
        name: 'entry',
        isEntry: true,
        imports: [],
        modules: {},
        code: `export const href = "/${ORIGINAL}"\n`,
      },
    },
    false,
  )

// The client's sheet is written under the original name first, as the copy a server discards
// takes its name from it.
await pass(environments.client)

const benchOptions = { iterations: 30, warmupIterations: 10, time: 1000 }

describe('early output pass, 3,000 atoms', () => {
  bench(
    'control: prune only',
    () => {
      pruneStaticCss(SHEET, session, { requiredClasses })
    },
    benchOptions,
  )

  bench(
    'a sheet the environment writes',
    async () => {
      await pass(environments.client)
    },
    benchOptions,
  )

  bench(
    'a copy the environment discards',
    async () => {
      await pass(environments.ssr)
    },
    benchOptions,
  )
})
