import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { logger } from '@bamboocss/logger'
import { analyze, loadConfigAndCreateContext, type BambooContext } from '@bamboocss/node'
import { TOKEN_CATEGORIES } from '@bamboocss/token-dictionary'
import { Console } from 'node:console'
import { resolve } from 'path'
import * as z from 'zod/v4'
import { version } from '../package.json'

const tokenCategorySchema = z
  .enum(TOKEN_CATEGORIES as [string, ...string[]])
  .optional()
  .describe('Filter by token category')

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

export interface CreateMcpServerOptions {
  ctx: BambooContext
}

/**
 * Create an MCP server with all tools registered.
 * This is separated from `startMcpServer` to allow testing with custom transports.
 */
export function createMcpServer(options: CreateMcpServerOptions) {
  const { ctx } = options

  const server = new McpServer({
    name: '@bamboocss/mcp',
    version,
  })

  // Create dynamic schemas from user's config
  const recipeNames = ctx.recipes.keys as [string, ...string[]]
  const patternNames = ctx.patterns.keys as [string, ...string[]]

  const recipeNameSchema = recipeNames.length
    ? z.enum(recipeNames).optional().describe('Filter by recipe name')
    : z.string().optional().describe('Filter by recipe name')

  const patternNameSchema = patternNames.length
    ? z.enum(patternNames).optional().describe('Filter by pattern name')
    : z.string().optional().describe('Filter by pattern name')

  // Register tools
  server.registerTool(
    'get_tokens',
    {
      description: 'Get all design tokens with their values, CSS variables, and usage examples',
      inputSchema: { category: tokenCategorySchema },
    },
    async ({ category }) => {
      const spec = ctx.getSpecOfType('tokens')
      const data = category ? spec.data.filter((group: any) => group.type === category) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_semantic_tokens',
    {
      description: 'Get semantic tokens with their conditional values (responsive, color modes)',
      inputSchema: { category: tokenCategorySchema },
    },
    async ({ category }) => {
      const spec = ctx.getSpecOfType('semantic-tokens')
      const data = category ? spec.data.filter((group: any) => group.type === category) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_recipes',
    {
      description: 'Get component recipes with their variants, default values, and usage examples',
      inputSchema: { name: recipeNameSchema },
    },
    async ({ name }) => {
      const spec = ctx.getSpecOfType('recipes')
      const data = name ? spec.data.filter((item: any) => item.name === name) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_patterns',
    {
      description: 'Get layout patterns with their properties and usage examples',
      inputSchema: { name: patternNameSchema },
    },
    async ({ name }) => {
      const spec = ctx.getSpecOfType('patterns')
      const data = name ? spec.data.filter((item: any) => item.name === name) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_conditions',
    { description: 'Get all conditions (breakpoints, pseudo-classes, color modes) and their CSS values' },
    async () => json(ctx.getSpecOfType('conditions')),
  )

  server.registerTool('get_keyframes', { description: 'Get keyframe animations defined in the theme' }, async () =>
    json(ctx.getSpecOfType('keyframes')),
  )

  server.registerTool(
    'get_mixins',
    { description: 'Get the named style bundles the theme declares, applied through the `mixin` style property' },
    async () => json(ctx.getSpecOfType('mixins')),
  )

  server.registerTool('get_color_palette', { description: 'Get the color palette with all color values' }, async () =>
    json(ctx.getSpecOfType('color-palette')),
  )

  server.registerTool(
    'get_config',
    { description: 'Get the resolved Bamboo CSS configuration including paths, JSX settings, and output options' },
    async () => json(ctx.config),
  )

  server.registerTool(
    'get_usage_report',
    {
      description:
        'Get a usage report of the design system across the codebase: design tokens, recipes, patterns, utilities and keyframes. Shows which are used and how often, and which are defined but unused. Useful for auditing, cleanup, and identifying dead code.',
      inputSchema: {
        scope: z
          .enum(['all', 'token', 'recipe', 'pattern', 'utility', 'keyframe'])
          .optional()
          .describe('Analysis scope: token, recipe, pattern, utility, keyframe, or all (default)'),
      },
    },
    async ({ scope }) => {
      const result = await analyze(ctx)
      const includes = (part: string) => !scope || scope === 'all' || scope === part

      const report: Record<string, unknown> = {}

      if (includes('token') && !ctx.tokens.isEmpty) {
        report.tokens = result.getTokenReport().report.getSummary()
      }

      if (includes('recipe') && !ctx.recipes.isEmpty()) {
        report.recipes = result.getRecipeReport().report
      }

      if (includes('pattern') && !ctx.patterns.isEmpty()) {
        report.patterns = result.getPatternReport()
      }

      if (includes('utility')) {
        report.utilities = result.getUtilityReport()
      }

      if (includes('keyframe')) {
        const keyframes = result.getKeyframeReport()
        if (keyframes.length) report.keyframes = keyframes
      }

      return json(report)
    },
  )

  return server
}

/**
 * Keep stdout to the protocol, and leave when the client has gone.
 *
 * Over stdio, stdout carries JSON-RPC and nothing else: a line printed there that is not a
 * message corrupts the stream. `silent` quieted the logger, but loading the config sets its level
 * from `logLevel` again, and `get_usage_report` then printed `Analyzing N file(s)` into it. The
 * `console` methods that write to stdout now write to stderr, which a client shows as the server's
 * log; the rest — `table`, `group`, `count` — print through `log`.
 *
 * A client that has gone leaves stdout without a reader, and a write to it fails with `EPIPE`.
 * Unheard, that reached the handler `@bamboocss/node` installs for uncaught errors, which logged
 * it — into a pipe without a reader, failing again — and kept the process alive doing so. Losing
 * stderr alone is a client that stopped reading the log, which costs only the log.
 */
let guarded = false
function guardStdio() {
  if (guarded) return
  guarded = true

  const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr })
  for (const method of ['log', 'info', 'debug', 'dir'] as const) {
    console[method] = toStderr[method].bind(toStderr)
  }

  const withoutReader = (error: NodeJS.ErrnoException) =>
    error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED'
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (withoutReader(error)) process.exit(0)
    throw error
  })
  process.stderr.on('error', (error: NodeJS.ErrnoException) => {
    if (!withoutReader(error)) throw error
  })
}

export interface StartMcpServerOptions {
  cwd?: string
  config?: string
  silent?: boolean
  transport?: Transport
}

/**
 * Start the MCP server with the given options.
 * By default, uses StdioServerTransport for CLI usage.
 */
export async function startMcpServer(options: StartMcpServerOptions = {}) {
  const { cwd = process.cwd(), config: configPath, silent = false, transport } = options

  // Before the config loads, which logs at the level the config sets.
  if (!transport) guardStdio()

  if (silent) {
    logger.level = 'silent'
  }

  const resolvedCwd = resolve(cwd)
  const resolvedConfigPath = configPath ? resolve(configPath) : undefined

  // Load Bamboo context
  const ctx = await loadConfigAndCreateContext({
    cwd: resolvedCwd,
    configPath: resolvedConfigPath,
  })

  // Create MCP server
  const server = createMcpServer({ ctx })

  // Connect to transport
  const serverTransport = transport ?? new StdioServerTransport()
  await server.connect(serverTransport)

  // Use stderr for logging (stdout is reserved for MCP protocol)
  console.error('Bamboo CSS MCP server started')
  console.error(`Working directory: ${resolvedCwd}`)
  if (resolvedConfigPath) {
    console.error(`Config path: ${resolvedConfigPath}`)
  }

  return server
}
