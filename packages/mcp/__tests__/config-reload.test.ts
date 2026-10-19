// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadConfigAndCreateContext } from '@bamboocss/node'
import { createContextSource } from '../src/context-source'
import { startMcpServer } from '../src/server'

/**
 * An MCP server lives as long as the agent's session, and the config is what a session edits. A
 * token or a recipe added while the server ran never reached `get_tokens` or `get_recipes` until
 * the client restarted it, which an agent cannot do and has no reason to think it should.
 */
const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-mcp-reload-')))
afterAll(() => rmSync(cwd, { force: true, recursive: true }))

const write = (file: string, contents: string) => writeFileSync(join(cwd, file), contents)

const config = (body: string, imports = '') =>
  `${imports}\nexport default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system', theme: { extend: { ${body} } } }\n`

let client: Client

beforeAll(async () => {
  mkdirSync(join(cwd, 'src'), { recursive: true })
  write('src/app.tsx', 'export const a = 1\n')
  write('bamboo.config.ts', config(`tokens: { colors: { first: { value: '#111' } } }`))

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await startMcpServer({ cwd, transport: serverTransport, silent: true })
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
})

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args })
  return { isError: Boolean(result.isError), text: (result.content as Array<{ text: string }>)[0]!.text }
}

describe('a config edited while the server runs', () => {
  test('reaches the tools on the next call', async () => {
    expect((await call('get_tokens')).text).toContain('first')

    write(
      'bamboo.config.ts',
      config(
        `tokens: { colors: { first: { value: '#111' }, second: { value: '#222' } } }, recipes: { card: { className: 'card', base: { color: 'red' } } }`,
      ),
    )

    expect((await call('get_tokens')).text).toContain('second')
    expect((await call('get_recipes')).text).toContain('card')
  })

  // A request is validated against the schema before any tool runs, so a filter that was an enum
  // of the names the server started with rejected the recipe the edit added.
  test('a recipe it adds can be asked for by name, and its name is listed', async () => {
    const recipe = await call('get_recipes', { name: 'card' })
    expect(recipe.isError).toBe(false)
    expect(recipe.text).toContain('card')

    const { tools } = await client.listTools()
    const schema = tools.find((tool) => tool.name === 'get_recipes')?.inputSchema as any
    expect(schema.properties.name.description).toContain('card')
  })

  test('a name the config does not define says which ones it does', async () => {
    const recipe = await call('get_recipes', { name: 'nope' })
    expect(recipe.isError).toBe(true)
    expect(recipe.text).toContain('No recipe is named `nope`. The recipes are: card.')
  })

  // A preset the edit swaps in is one of the config's files from then on.
  test('a module the config starts importing is followed', async () => {
    write('brand.ts', `export const brand = { brandOne: { value: '#333' } }\n`)
    write('bamboo.config.ts', config(`tokens: { colors: { ...brand } }`, `import { brand } from './brand'`))
    expect((await call('get_tokens')).text).toContain('brandOne')

    write('brand.ts', `export const brand = { brandOne: { value: '#333' }, brandTwo: { value: '#444' } }\n`)
    expect((await call('get_tokens')).text).toContain('brandTwo')
  })

  // Answering from the previous config would be the same silence this replaces.
  test('a config that fails to load fails the call, and the next one after the fix answers', async () => {
    write('bamboo.config.ts', `export default {\n`)
    expect((await call('get_tokens')).isError).toBe(true)

    write('bamboo.config.ts', config(`tokens: { colors: { third: { value: '#555' } } }`))
    const tokens = await call('get_tokens')
    expect(tokens.isError).toBe(false)
    expect(tokens.text).toContain('third')
  })
})

describe('the files a config is built from', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach((root) => rmSync(root, { force: true, recursive: true })))

  const project = () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-mcp-files-')))
    roots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/app.tsx'), 'export const a = 1\n')
    return { root, write: (file: string, contents: string) => writeFileSync(join(root, file), contents) }
  }

  const connect = async (root: string) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await startMcpServer({ cwd: root, transport: serverTransport, silent: true })
    const connected = new Client({ name: 'test', version: '0.0.0' })
    await connected.connect(clientTransport)
    return async () => {
      const result = await connected.callTool({ name: 'get_tokens', arguments: {} })
      return (result.content as Array<{ text: string }>)[0]!.text
    }
  }

  // Bundled on its own, so its files were not the config bundle's, and an edit to it was not seen.
  test('a preset named by path', async () => {
    const { root, write } = project()
    write('brand.ts', `export default { theme: { tokens: { colors: { brandOne: { value: '#333' } } } } }\n`)
    write(
      'bamboo.config.ts',
      `export default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system', presets: ['./brand.ts'] }\n`,
    )
    const tokens = await connect(root)
    expect(await tokens()).toContain('brandOne')

    write(
      'brand.ts',
      `export default { theme: { tokens: { colors: { brandOne: { value: '#333' }, brandTwo: { value: '#444' } } } } }\n`,
    )
    expect(await tokens()).toContain('brandTwo')
  })

  // No stamp was taken of a file that did not match when the config loaded.
  test('a file that starts to match `dependencies`', async () => {
    const { root, write } = project()
    mkdirSync(join(root, 'tokens'))
    write('tokens/a.json', JSON.stringify({ alpha: { value: '#111' } }))
    write(
      'bamboo.config.ts',
      `import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(__dirname, 'tokens')
const colors = Object.assign({}, ...readdirSync(dir).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))))
export default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system', dependencies: ['tokens/*.json'], theme: { extend: { tokens: { colors } } } }
`,
    )
    const tokens = await connect(root)
    expect(await tokens()).toContain('alpha')

    write('tokens/b.json', JSON.stringify({ beta: { value: '#222' } }))
    expect(await tokens()).toContain('beta')
  })

  // Globbed once the load had finished, a match that appeared while it ran was recorded as seen.
  test('a file that starts to match `dependencies` while a reload runs', async () => {
    const { root, write } = project()
    mkdirSync(join(root, 'tokens'))
    write('tokens/a.json', JSON.stringify({ alpha: { value: '#111' } }))
    write(
      'bamboo.config.ts',
      `import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(__dirname, 'tokens')
const colors = Object.assign({}, ...readdirSync(dir).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))))
export default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system', dependencies: ['tokens/*.json'], theme: { extend: { tokens: { colors } } } }
`,
    )
    let duringLoad: (() => void) | undefined
    const current = createContextSource(async () => {
      const ctx = await loadConfigAndCreateContext({ cwd: root })
      duringLoad?.()
      duringLoad = undefined
      return ctx
    })
    await current()

    write('tokens/b.json', JSON.stringify({ beta: { value: '#222' } }))
    // Written clearly before the reload starts, so only the file written during it is fresh.
    await new Promise((resolve) => setTimeout(resolve, 50))
    duringLoad = () => write('tokens/c.json', JSON.stringify({ gamma: { value: '#333' } }))
    await current()
    const after = await current()
    expect(after.tokens.getByName('colors.gamma')).toBeDefined()
  })

  // Stamped once the load had finished, an edit landing while it ran was recorded as seen.
  test('an edit that lands while a reload runs', async () => {
    const { root, write } = project()
    write('brand.ts', `export const brand = { brandOne: { value: '#333' } }\n`)
    write(
      'bamboo.config.ts',
      `import { brand } from './brand'\nexport default { preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system', theme: { extend: { tokens: { colors: brand } } } }\n`,
    )
    let duringLoad: (() => void) | undefined
    const current = createContextSource(async () => {
      const ctx = await loadConfigAndCreateContext({ cwd: root })
      duringLoad?.()
      duringLoad = undefined
      return ctx
    })
    await current()

    write('brand.ts', `export const brand = { brandOne: { value: '#333' }, brandTwo: { value: '#444' } }\n`)
    duringLoad = () =>
      write(
        'brand.ts',
        `export const brand = { brandOne: { value: '#333' }, brandTwo: { value: '#444' }, brandThree: { value: '#555' } }\n`,
      )
    await current()
    const after = await current()
    expect(after.tokens.getByName('colors.brandThree')).toBeDefined()
  })
})
