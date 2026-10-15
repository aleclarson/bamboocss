import { logger } from '@bamboocss/logger'
import { BambooError } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { build, type Plugin } from 'esbuild'
import findUp from 'escalade/sync'
import { mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findConfig } from './find-config'
import type { BundleConfigResult, ConfigFileOptions } from './types'

const require = createRequire(import.meta.url)

/**
 * What each bundled file's `__dirname`, `__filename` and `import.meta` paths are rewritten to.
 *
 * Bundling puts every file the config imports into one module, so without this they would all
 * see the bundle's location — and a CommonJS bundle has no `import.meta` at all, which is why
 * `fileURLToPath(import.meta.url)` in a config used to fail. Each file is handed its own values
 * instead, under names nothing else uses.
 */
const DIRNAME = '__bamboo_injected_dirname'
const FILENAME = '__bamboo_injected_filename'
const IMPORT_META_URL = '__bamboo_injected_import_meta_url'

/**
 * A real `require` for an ES module bundle.
 *
 * The bundle inlines the CommonJS packages a config imports, as the CommonJS one always has, and
 * esbuild can only turn their `require()` of a built-in into a call that throws `Dynamic require
 * of "fs" is not supported` unless a `require` is in scope. esbuild renames a config's own
 * top-level `require` around this one, so `createRequire(import.meta.url)` in a config still works.
 */
const REQUIRE_BANNER =
  `import { createRequire as __bamboo_createRequire } from 'node:module';` +
  `var require = __bamboo_createRequire(import.meta.url);`

/**
 * Bundle a config — or a preset named by a string — and evaluate it, much as Vite loads
 * `vite.config.ts`.
 *
 * An ES module — `.mjs`/`.mts`, or a `.js`/`.ts` under `"type": "module"` — is bundled as ESM and
 * imported from a temporary file, so top-level `await` and `import.meta` work. Anything else is
 * bundled as CommonJS and compiled in place of the file, as before. Either way everything the file
 * imports is inlined, so the two load the same packages the same way.
 *
 * An error the config throws is the error reported. Loading used to fall back to `node-eval` on
 * any failure, which ran the config a second time and replaced the real error with that
 * fallback's own, `Please pass in filename to use require`.
 */
export async function bundle<T extends Config = Config>(filepath: string, cwd: string) {
  // A path, or a package name — a string preset is loaded through here too — resolved from `cwd`.
  const file = require.resolve(filepath, { paths: [cwd] })
  const esm = isEsmFile(file)
  const { code, dependencies } = await bundleFile(file, cwd, esm)

  let mod: any
  try {
    mod = esm ? await importBundled(file, code) : requireBundled(file, code)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BambooError('CONFIG_ERROR', `💥 Failed to load ${file}: ${reason}`, { cause: error })
  }

  // A module with no default export is its exports, as `module.exports` is in a CommonJS one —
  // copied, since an ES module namespace cannot be written to and the config is.
  const config = (mod?.default ?? (mod && { ...mod })) as T

  return {
    config,
    dependencies,
  }
}

/** Whether Node would load `file` as an ES module. */
function isEsmFile(file: string): boolean {
  if (/\.m[jt]s$/.test(file)) return true
  if (/\.c[jt]s$/.test(file)) return false

  const manifest = findUp(dirname(file), (_dir, names) => names.includes('package.json') && 'package.json')
  if (!manifest) return false
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module'
  } catch {
    return false
  }
}

async function bundleFile(file: string, cwd: string, esm: boolean) {
  const result = await build({
    absWorkingDir: cwd,
    entryPoints: [file],
    outfile: 'out.js',
    write: false,
    platform: 'node',
    target: [`node${process.versions.node}`],
    format: esm ? 'esm' : 'cjs',
    mainFields: ['module', 'main'],
    bundle: true,
    sourcemap: false,
    metafile: true,
    define: {
      __dirname: DIRNAME,
      __filename: FILENAME,
      'import.meta.url': IMPORT_META_URL,
      'import.meta.dirname': DIRNAME,
      'import.meta.filename': FILENAME,
    },
    ...(esm && { banner: { js: REQUIRE_BANNER } }),
    plugins: [injectFileScopeVariables],
  })

  return {
    code: result.outputFiles[0].text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : [],
  }
}

/**
 * What has to stay at the top of a file: a hashbang, then a directive prologue such as
 * `'use strict'`, comments around it included — a published package often opens with a licence
 * comment. Code in front of a directive turns it into an ordinary string, and a module that
 * relied on strict mode would run sloppy.
 *
 * A string is a directive only as a statement of its own, so one has to end at a `;`, or at a
 * line break that is not followed by something continuing it: `'a,b'` then `.split(',')` on the
 * next line is one expression, and splitting it would change what it means.
 */
const PROLOGUE =
  /^(?:#!.*\n)?(?:(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*(?:'[^'\\\n]*'|"[^"\\\n]*")[ \t]*(?:;|(?=\r?\n\s*(?![\s.,([`+\-*/%&|^?:<>=!]))))*/

/** Whether a file reads anything the injected variables stand in for. */
const NEEDS_SCOPE = /__dirname|__filename|import\.meta/

/** Give each bundled file that reads them its own `__dirname`, `__filename` and `import.meta`. */
const injectFileScopeVariables: Plugin = {
  name: 'bamboo:inject-file-scope-variables',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
      const contents = await readFile(args.path, 'utf8')
      // Left to esbuild's own loader otherwise: most of what a config inlines reads none of them.
      if (!NEEDS_SCOPE.test(contents)) return
      const variables =
        `var ${DIRNAME} = ${JSON.stringify(dirname(args.path))};` +
        `var ${FILENAME} = ${JSON.stringify(args.path)};` +
        `var ${IMPORT_META_URL} = ${JSON.stringify(pathToFileURL(args.path).href)};`
      const prologue = PROLOGUE.exec(contents)?.[0] ?? ''
      // A newline after a directive, so a missing semicolon cannot join it to what follows.
      const separator = prologue && !prologue.endsWith('\n') ? '\n' : ''
      return {
        contents: `${prologue}${separator}${variables}${contents.slice(prologue.length)}`,
        loader: loaderFor(args.path),
      }
    })
  },
}

function loaderFor(file: string) {
  if (/\.[cm]?ts$/.test(file)) return 'ts' as const
  if (file.endsWith('.tsx')) return 'tsx' as const
  if (file.endsWith('.jsx')) return 'jsx' as const
  return 'js' as const
}

/**
 * Where an ES module bundle is written to be imported: `.bamboo` in the nearest `node_modules`.
 *
 * Not beside the config, where a watcher or an `include` glob would see it come and go — both
 * leave `node_modules` alone — and a module runner such as vitest's hands a file under it to
 * Node rather than resolving it itself. Without one — Yarn PnP, say — the system's temporary
 * directory, rather than a `node_modules` made for the purpose. Nothing in the bundle resolves
 * relative to the file but the banner's `require`, and only a built-in is left for that.
 */
function bundleDirFor(file: string): string {
  const modules = findUp(dirname(file), (_dir, names) => names.includes('node_modules') && 'node_modules')
  return modules ? join(modules, '.bamboo') : tmpdir()
}

/**
 * Import an ES module bundle from a temporary file.
 *
 * The name is unique to the load, so a changed config is never answered from Node's module
 * cache. The cost, shared with Vite's own config loader, is that a long session keeps each
 * version it loaded: ES modules cannot be evicted.
 */
async function importBundled(file: string, code: string) {
  const name = `bamboo.config.timestamp-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.mjs`
  let temp = join(bundleDirFor(file), name)
  try {
    writeTemp(temp, code)
  } catch {
    temp = join(tmpdir(), name)
    writeTemp(temp, code)
  }
  try {
    return await import(pathToFileURL(temp).href)
  } finally {
    try {
      unlinkSync(temp)
    } catch {
      // Already gone: nothing is left to clean up.
    }
  }
}

function writeTemp(file: string, code: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, code)
}

/** Compile a CommonJS bundle as the file itself, so its `require` resolves from there. */
function requireBundled(file: string, code: string) {
  const extension = extname(file)
  const realFileName = realpathSync.native(file)
  const extensions = require.extensions
  const previous = extensions[extension]

  extensions[extension] = (module: any, filename: string) => {
    if (filename === realFileName) {
      module._compile(code, filename)
    } else {
      ;(previous ?? extensions['.js'])(module, filename)
    }
  }

  try {
    delete require.cache[require.resolve(file)]
    return require(file)
  } finally {
    if (previous) {
      extensions[extension] = previous
    } else {
      delete extensions[extension]
    }
  }
}

export async function bundleConfig(options: ConfigFileOptions): Promise<BundleConfigResult> {
  const { cwd, file } = options

  const filePath = findConfig({ cwd, file })

  logger.debug('config:path', filePath)

  const result = await bundle(filePath, cwd)

  if (typeof result.config !== 'object') {
    throw new BambooError('CONFIG_ERROR', `💥 Config must export or return an object.`)
  }

  result.config.outdir ??= 'styled-system'
  result.config.validation ??= 'warn'

  return {
    ...result,
    config: result.config,
    path: filePath,
  }
}
