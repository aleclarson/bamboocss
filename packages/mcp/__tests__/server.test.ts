// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfigAndCreateContext } from '@bamboocss/node'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { version } from '../package.json'
import { createMcpServer } from '../src/server'

const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

const project = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-mcp-'))
  directories.push(cwd)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  return cwd
}

let client: Client
let ctx: Awaited<ReturnType<typeof loadConfigAndCreateContext>>

beforeAll(async () => {
  const cwd = project({
    'bamboo.config.ts': `export default {
      preflight: false,
      include: ['src/**/*.tsx'],
      outdir: 'styled-system',
      theme: { extend: { keyframes: { fade: { from: { opacity: 0 }, to: { opacity: 1 } } } } },
    }`,
    'src/app.tsx': [
      `import { css, cva, sva } from '../styled-system/css'`,
      `import { flex as row } from '../styled-system/patterns'`,
      `export const a = css({ animation: 'spin 1s linear infinite', color: 'red.300' })`,
      `export const b = row({ gap: '4' })`,
      `export const c = css({ animation: { base: 'bounce', md: 'none' }, bg: { base: 'red.300', md: 'blue.300' } })`,
      `export const d = css({ animationName: 'ping' })`,
      `export const e = css({ animation: 'token(animations.pulse)' })`,
      `export const f = cva({ base: { color: 'red.300' }, variants: { tone: { calm: { _hover: { animation: { md: 'spin' } } } } }, defaultVariants: { tone: 'calm' } })`,
      `export const g = sva({ slots: ['root'], base: { root: { animation: 'bounce' } } })`,
      ``,
    ].join('\n'),
  })
  ctx = await loadConfigAndCreateContext({ cwd })
  const server = createMcpServer({ ctx })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
})

const usage = async (scope?: string) => {
  const result = await client.callTool({ name: 'get_usage_report', arguments: scope ? { scope } : {} })
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
}

// It said `1.0.0` whatever was installed, so a client could not tell one release from another.
test('reports the version installed', () => {
  expect(client.getServerVersion()).toMatchObject({ name: '@bamboocss/mcp', version })
})

/**
 * The report covered tokens and recipes. A design system is patterns, utilities and keyframes as
 * well, and what an audit wants of each is what goes unused as much as what is used.
 */
describe('the usage report', () => {
  // Under the name it is exported as, whatever it is imported as.
  test('counts each pattern called, and lists the ones never called', async () => {
    const { patterns } = await usage('pattern')

    expect(patterns).toContainEqual({ patternName: 'flex', usedCount: 1, usedInXFiles: 1 })
    expect(patterns).toContainEqual(expect.objectContaining({ patternName: 'grid', usedCount: 0 }))
  })

  // A value keyed by a condition is as much a use, and a shorthand is the property it stands for.
  test('counts each style property written', async () => {
    const { utilities } = await usage('utility')

    expect(utilities).toContainEqual({ propName: 'color', usedCount: 2, usedInXFiles: 1 })
    expect(utilities).toContainEqual({ propName: 'animation', usedCount: 6, usedInXFiles: 1 })
    expect(utilities).toContainEqual({
      propName: ctx.utility.resolveShorthand('bg'),
      usedCount: 2,
      usedInXFiles: 1,
    })
    // Not a variant a call's config names, nor a condition, nor `base`.
    const names = utilities.map((entry: { propName: string }) => entry.propName)
    for (const name of ['bg', 'tone', 'md', '_hover', 'base']) expect(names).not.toContain(name)
  })

  // Named in the value, or in the `animations` token the value names, by name or through `token()`.
  test('counts each keyframe an animation names, and lists the ones none does', async () => {
    const { keyframes } = await usage('keyframe')

    expect(keyframes).toEqual(
      expect.arrayContaining(
        [
          ['spin', 2],
          ['bounce', 2],
          ['ping', 1],
          ['pulse', 1],
        ].map(([keyframe, usedCount]) => ({ keyframe, usedCount, usedInXFiles: 1 })),
      ),
    )
    expect(keyframes).toContainEqual({ keyframe: 'fade', usedCount: 0, usedInXFiles: 0 })
  })

  // Recipes too, for a config that has any; this one does not.
  test('covers all of them by default', async () => {
    expect(Object.keys(await usage()).sort()).toEqual(['keyframes', 'patterns', 'tokens', 'utilities'])
  })
})
