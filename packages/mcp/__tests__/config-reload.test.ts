// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
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
