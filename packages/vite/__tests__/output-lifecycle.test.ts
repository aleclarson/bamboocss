import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@bamboocss/logger'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import type { Plugin } from 'vite'
import { VIRTUAL_CSS_ID } from '../src/css'
import { bamboocss } from '../src/plugin'

/**
 * The output lifecycle across environments, hook by hook, in the orders a watch or a builder can
 * run them in: what a sheet is pruned against, which name a server's copy of it links, and what the
 * guard reads. The orders that matter here are the ones no single real build pins — one
 * environment's whole build phase between another's output pass and its write, a write another
 * plugin rejects — so the hooks are driven directly, as Vite calls them.
 */
const hookOf = (hook: unknown) =>
  (typeof hook === 'function' ? hook : (hook as { handler?: unknown } | undefined)?.handler) as (
    this: unknown,
    ...args: unknown[]
  ) => unknown

interface EnvironmentSpec {
  name: string
  consumer: 'client' | 'server'
  build?: Record<string, unknown>
}
const client: EnvironmentSpec = { name: 'client', consumer: 'client', build: { emitAssets: true } }
const ssr: EnvironmentSpec = { name: 'ssr', consumer: 'server', build: { ssr: true, emitAssets: false } }

const source = (sheetImport: string | false, ...widths: string[]) =>
  (sheetImport ? `import ${sheetImport}\n` : '') +
  `import { css } from 'styled-system/css'\n` +
  widths.map((width, index) => `export const c${index} = css({ width: '[${width}]' })\n`).join('')

/** A project of its own, outside the checkout, with every environment's output under it. */
const createProject = () => {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-output-lifecycle-')))
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default { include: ['./src/**/*.{js,jsx,ts,tsx}'], outdir: 'styled-system' }\n`,
  )
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  return cwd
}

interface Behaviour {
  /** How the environment's graph reaches the stylesheet. */
  imports?: 'sheet' | 'url' | false
  /** Delete every asset after the early pass, as Vite does for an environment discarding them. */
  discard?: boolean
  /** Empty the output directory as rendering starts, as a watch rebuild with `emptyOutDir` does. */
  empty?: boolean
  /** Throw from a later plugin's `generateBundle`: nothing is written, and no hook says so. */
  reject?: boolean
  /** Run between the early pass and the late one. */
  between?: () => Promise<void> | void
  /** The name Vite gives the sheet; it moves when what is extracted does. */
  sheetName?: string
}

/** Drives every hook of the plugin a Vite environment build reaches, in order, against one project. */
const createRun = async (cwd: string, watch: boolean, announced: string[] | false) => {
  const list = bamboocss({ cwd, reportSummary: false })
  const css = list.find((plugin) => plugin.name === 'bamboocss:css')!
  const early = list.find((plugin) => plugin.name === 'bamboocss:css-early')!
  const compiler = list.find((plugin) => plugin.name === 'bamboocss:compiler')!
  const resolvedCss = hookOf(css.resolveId).call({}, VIRTUAL_CSS_ID, undefined, {}) as string
  const plugins: Plugin[] = []
  const config = {
    command: 'build',
    root: cwd,
    build: { sourcemap: false, watch: watch ? {} : null, cssCodeSplit: true },
    css: {},
    configFileDependencies: [],
    plugins,
    ...(announced ? { builder: {}, environments: Object.fromEntries(announced.map((name) => [name, {}])) } : {}),
  }
  const exitListeners = new Set(process.listeners('beforeExit'))
  await hookOf(css.configResolved).call({}, config)
  await hookOf(compiler.configResolved).call({}, config)
  const exitWarnings = process.listeners('beforeExit').filter((listener) => !exitListeners.has(listener))
  for (const listener of exitWarnings) process.off('beforeExit', listener)
  const observer = plugins.find((plugin) => plugin.name === 'bamboocss:output-write-observer')!
  const outputs = new Map<string, { dir: string; plugins: Array<Record<string, unknown>> }>()

  /** One generation, in two halves: `start` runs it through `transform`, what it returns the rest. */
  const start = async (
    spec: EnvironmentSpec,
    modules: Array<{ id: string; code: string }>,
    behaviour: Behaviour = {},
  ) => {
    const environment = {
      name: spec.name,
      config: { consumer: spec.consumer, build: { sourcemap: false, cssCodeSplit: true, ...spec.build } },
    }
    const imports = behaviour.imports ?? false
    const ids = [
      ...modules.map((module) => module.id),
      ...(imports === 'sheet'
        ? [resolvedCss]
        : imports === 'url'
          ? [`${resolvedCss}?url`, `${resolvedCss}?transform-only`]
          : []),
    ]
    const context = { addWatchFile() {}, environment, getModuleIds: () => ids.values(), getModuleInfo: () => null }
    const dir = join(cwd, `out-${spec.name}`)
    let output = outputs.get(spec.name)
    if (!output) {
      output = { dir, plugins: [] }
      outputs.set(spec.name, output)
    }
    hookOf(compiler.options).call({ environment }, { output })
    const [startMarker] = output.plugins
    const finalizer = output.plugins.at(-1)!
    hookOf(observer.buildStart).call(context)
    await hookOf(css.buildStart).call(context, {})
    await hookOf(compiler.buildStart).call(context, {})
    const sheet = imports ? ((await hookOf(css.load).call(context, resolvedCss, {})) as string) : undefined
    for (const module of modules) await hookOf(compiler.transform).call(context, module.code, module.id, {})

    return async () => {
      hookOf(compiler.buildEnd).call(context, undefined)
      hookOf(startMarker!.renderStart).call(context)
      hookOf(early.renderStart).call(context, output)
      if (behaviour.empty) rmSync(dir, { recursive: true, force: true })
      const sheetName = behaviour.sheetName ?? 'assets/style-ORIGINAL.css'
      const bundle: Record<string, Record<string, unknown>> = {
        'entry.js': {
          type: 'chunk',
          fileName: 'entry.js',
          name: 'entry',
          isEntry: true,
          imports: [],
          modules: Object.fromEntries(modules.map((module) => [module.id, {}])),
          code: imports === 'url' ? `export const href = "/${sheetName}"\n` : `export const x = 1\n`,
        },
        ...(sheet === undefined
          ? {}
          : { [sheetName]: { type: 'asset', fileName: sheetName, names: [], originalFileNames: [], source: sheet } }),
      }
      const outputContext = { environment }
      await hookOf(early.generateBundle).call(outputContext, output, bundle, true)
      if (behaviour.discard) {
        for (const key of Object.keys(bundle)) if (bundle[key]!.type === 'asset') delete bundle[key]
      }
      await behaviour.between?.()
      await hookOf(css.generateBundle).call(outputContext, output, bundle, true)
      if (behaviour.reject) throw new Error(`a later plugin rejected the ${spec.name} output`)
      hookOf(finalizer.generateBundle).call(output, output, bundle, true)
      for (const entry of Object.values(bundle)) {
        const path = join(dir, entry.fileName as string)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, (entry.type === 'asset' ? entry.source : entry.code) as string)
      }
      await hookOf(observer.writeBundle).call(context, output, bundle)
    }
  }
  const round = async (spec: EnvironmentSpec, modules: Array<{ id: string; code: string }>, behaviour?: Behaviour) =>
    (await start(spec, modules, behaviour))()

  const sheets = (name: string) => {
    const walk = (directory: string): string[] =>
      existsSync(directory)
        ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
              ? walk(join(directory, entry.name))
              : entry.name.endsWith('.css')
                ? [join(directory, entry.name)]
                : [],
          )
        : []
    return walk(join(cwd, `out-${name}`))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
  }
  /** Every stylesheet the server's written entry links, and whether the client wrote it. */
  const serverLinks = () =>
    [...readFileSync(join(cwd, 'out-ssr/entry.js'), 'utf8').matchAll(/assets\/[\w.-]+\.css/g)].map(([href]) => ({
      href,
      written: existsSync(join(cwd, 'out-client', href)),
    }))
  /** What the process says as it exits. */
  const exit = () => {
    const warnings: string[] = []
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((_scope: string, message: string) => void warnings.push(message))
    try {
      for (const listener of exitWarnings) (listener as (code: number) => void)(0)
    } finally {
      spy.mockRestore()
    }
    return warnings
  }
  return { start, round, sheets, serverLinks, exit }
}

describe('a watch round with a sibling replacing its output', () => {
  /**
   * Its output pass ran before this environment began replacing, so its sheet was pruned unheld
   * and is final. Read past as one still to be pruned, the class shipped with no rule and no error.
   */
  test("one environment's whole build between the other's output pass and its write still fails the guard", async () => {
    const cwd = createProject()
    const widths = { kept: '75.1px', pruned: '75.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.pruned))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    let failure: unknown
    await run.round(client, clientModules, {
      imports: 'sheet',
      between: async () => {
        await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.pruned) }]).catch((error) => {
          failure = error
        })
      },
    })

    expect(String(failure)).toContain('already pruned out of a stylesheet')
    expect(String(failure)).toContain('w_\\[75\\.2px\\]')
  })

  /**
   * Nothing reports an output another plugin rejects after Bamboo's output pass, and the
   * environment went on replacing an output it never wrote: an SSR rebuild alone, newly using a
   * class the sheet on disk lacks, passed.
   */
  test('an output rejected after the output pass still answers for what its sheet lost', async () => {
    const cwd = createProject()
    const widths = { kept: '71.1px', fresh: '71.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    await expect(run.round(client, clientModules, { imports: 'sheet', reject: true })).rejects.toThrow(
      'a later plugin rejected the client output',
    )
    await expect(run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])).rejects.toThrow(
      'already pruned out of a stylesheet',
    )
  })

  /**
   * A sheet held for a sibling's replacement, whose own output then failed in one of Bamboo's output
   * hooks: the environment went on replacing an output it never wrote, and the held sheet waited for
   * it for good. Under a name nothing wrote, it holds nothing, and the guard reads the sheet on disk;
   * under the name of the sheet on disk — the same bytes — it is that sheet, pruned again with the
   * sibling's output once that is written.
   */
  test.each([
    ['under a name nothing wrote, the guard reads the sheet on disk', true],
    ['under the name of the sheet on disk, that sheet is pruned again', false],
  ])('a held sheet whose output Bamboo itself failed: %s', async (_, newBytes) => {
    const cwd = createProject()
    const widths = { kept: '76.1px', fresh: '76.2px', more: '76.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept, widths.more))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = (...used: string[]) => [{ id: clientId, code: source(`'virtual:bamboo.css'`, ...used) }]
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    // SSR is replacing its output while the client's sheet is pruned, so the sheet is held; the
    // client's output then loses it, and the late pass fails the output.
    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    const rebuilt = newBytes ? clientModules(widths.kept, widths.more) : clientModules(widths.kept)
    await expect(run.round(client, rebuilt, { imports: 'sheet', discard: true })).rejects.toThrow(
      'no emitted asset carries the generated stylesheet',
    )
    if (newBytes) {
      await expect(finishSsr()).rejects.toThrow('already pruned out of a stylesheet')
    } else {
      await finishSsr()
      expect(run.sheets('client')).toContain('.w_\\[76\\.2px\\]')
    }
  })
})

describe("a server's link to its discarded copy of the sheet", () => {
  const setUp = async (watch: boolean) => {
    const cwd = createProject()
    const widths = { kept: '72.1px', fresh: '72.2px', clientOnly: '72.3px' }
    const appId = join(cwd, 'src/app.tsx')
    writeFileSync(appId, source(`href from 'virtual:bamboo.css?url'`, widths.kept))
    // Extracted, and reached by nothing until an edit reaches it.
    writeFileSync(join(cwd, 'src/inventory.tsx'), source(false, widths.fresh, widths.clientOnly))
    const run = await createRun(cwd, watch, ['client', 'ssr'])
    const app = (...used: string[]) => [{ id: appId, code: source(`href from 'virtual:bamboo.css?url'`, ...used) }]
    return { run, app, widths }
  }
  const written = (links: Array<{ href: string; written: boolean }>) => {
    expect(links).not.toEqual([])
    for (const link of links)
      expect(link, `${link.href} is not in the client's output`).toMatchObject({ written: true })
  }

  test('names the sheet the client wrote first', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(client, app(widths.kept), { imports: 'url' })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    written(run.serverLinks())
  })

  test('written first, moves to the sheet the client writes after it', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    await run.round(client, app(widths.kept, widths.fresh), { imports: 'url' })
    written(run.serverLinks())
    expect(run.exit()).toEqual([])
  })

  /**
   * The edit moves reachability and not what is extracted, so Vite's name for the sheet stays, and
   * SSR's output, first, took the name the client's sheet had before. That sheet is gone once the
   * output directory is emptied, and nothing moved the link.
   */
  test('in a watch, moves with a sheet the client writes again after it', async () => {
    const { run, app, widths } = await setUp(true)
    await run.round(client, app(widths.kept), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true, empty: true })
    const finishClient = await run.start(client, app(widths.kept, widths.fresh), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept, widths.fresh), { imports: 'url', discard: true, empty: true })
    await finishClient()
    written(run.serverLinks())
  })

  /**
   * The edit changes what is extracted, so Vite names the sheet anew. The client named and wrote
   * its sheet between SSR's output pass and SSR's write, and the link was moved in SSR's files from
   * the round before, which the write after it replaced.
   */
  test('in a watch, moves only the links its own written output makes', async () => {
    const { run, app, widths } = await setUp(true)
    await run.round(client, app(widths.kept), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true, empty: true })
    const sheetName = 'assets/style-CHANGED.css'
    // The client reaches a class SSR does not, so the sheet it writes is named after other bytes.
    const finishClient = await run.start(client, app(widths.kept, widths.fresh, widths.clientOnly), {
      imports: 'url',
      empty: true,
      sheetName,
    })
    await run.round(ssr, app(widths.kept, widths.fresh), {
      imports: 'url',
      discard: true,
      empty: true,
      sheetName,
      between: finishClient,
    })
    written(run.serverLinks())
  })

  test('says so as the process exits when no sheet of its name was ever written', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    expect(run.exit().join('\n')).toContain('"ssr" links assets/style-ORIGINAL')
  })

  /** Imported for its effect, the copy is linked by nothing, and nothing has to serve its name. */
  test('says nothing for a copy its output never links', async () => {
    const cwd = createProject()
    const entry = join(cwd, 'src/entry.server.tsx')
    writeFileSync(entry, source(`'virtual:bamboo.css'`, '74.1px'))
    writeFileSync(join(cwd, 'src/unused.tsx'), source(false, '74.2px'))
    const run = await createRun(cwd, false, false)
    await run.round(ssr, [{ id: entry, code: source(`'virtual:bamboo.css'`, '74.1px') }], {
      imports: 'sheet',
      discard: true,
    })
    expect(run.exit()).toEqual([])
  })
})
