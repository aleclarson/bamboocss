// @vitest-environment node
// Loading an ES module config imports a file it writes, which the repo's default `happy-dom`
// environment cannot resolve outside the project: it reads modules as a browser would. A config
// is loaded in Node, so this is the environment to load one in.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path, { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { bundle, bundleConfig } from '../src/bundle-config'
import { getResolvedConfig } from '../src/get-resolved-config'
import { resolveSolutionAliases } from '../src/tsconfig-utils'

describe('bundle config', () => {
  const cwd = process.cwd()
  const _dirname = dirname(fileURLToPath(import.meta.url))

  // TODO test nested files dependencies + use files inside folders + use files with different extensions

  test('should bundle .ts config wits tsconfig path aliases', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/with-tsconfig-paths/bamboo.config.ts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "colors": {
                  "some-color": {
                    "value": "#2f81f7",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/with-tsconfig-paths/src/theme/tokens.ts",
          "packages/config/__tests__/samples/with-tsconfig-paths/bamboo.config.ts",
        ],
      }
    `)
  })

  test('should bundle .ts config wits nested files and barrels', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/nested-files/bamboo.config.ts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "colors": {
                  "another-color": {
                    "value": "#76e3ea",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/nested-files/src/theme/colors.ts",
          "packages/config/__tests__/samples/nested-files/src/theme/tokens.ts",
          "packages/config/__tests__/samples/nested-files/src/theme/index.ts",
          "packages/config/__tests__/samples/nested-files/src/index.ts",
          "packages/config/__tests__/samples/nested-files/bamboo.config.ts",
        ],
      }
    `)
  })

  test('should bundle .ts config with different preset loading methods', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/with-preset/bamboo.config.ts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
            {
              "name": "ts-import-preset",
              "theme": {
                "extend": {
                  "semanticTokens": {
                    "colors": {
                      "inverted": {
                        "default": {
                          "value": {
                            "_dark": "token(colors.black)",
                            "base": "white",
                          },
                        },
                      },
                      "placeholder": {
                        "value": {
                          "_dark": "token(colors.gray.400)",
                          "base": "token(colors.gray.600)",
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              "requiredPreset": {
                "name": "required-preset",
                "theme": {
                  "extend": {
                    "semanticTokens": {
                      "colors": {
                        "muted": {
                          "value": {
                            "_dark": "token(colors.gray.400)",
                            "base": "token(colors.gray.500)",
                          },
                        },
                        "subtle": {
                          "value": {
                            "_dark": "token(colors.gray.500)",
                            "base": "token(colors.gray.400)",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
          "theme": {
            "extend": {
              "tokens": {
                "colors": {
                  "color-primary": {
                    "value": "#000",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/with-preset/src/ts-import-preset.ts",
          "packages/config/__tests__/samples/with-preset/src/required-preset.ts",
          "packages/config/__tests__/samples/with-preset/bamboo.config.ts",
        ],
      }
    `)
  })

  test('should bundle .ts config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/ts/bamboo.config.ts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/ts/bamboo.config.ts",
        ],
      }
    `)
  })

  test('should bundle .cts config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/cts/bamboo.config.cts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/cts/bamboo.config.cts",
        ],
      }
    `)
  })

  test('should bundle .mts config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/mts/bamboo.config.mts')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/mts/bamboo.config.mts",
        ],
      }
    `)
  })

  test('should bundle .js config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/js/bamboo.config.js')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/js/bamboo.config.js",
        ],
      }
    `)
  })

  test('should bundle .cjs config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/cjs/bamboo.config.cjs')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.cjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/cjs/bamboo.config.cjs",
        ],
      }
    `)
  })

  test('should bundle .mjs config', async () => {
    const filePath = path.resolve(cwd, _dirname, './samples/mjs/bamboo.config.mjs')
    const { config, dependencies } = await bundle(filePath, cwd)
    expect({ config, dependencies: dependencies.map((dep) => dep.replace(_dirname, '')) }).toMatchInlineSnapshot(`
      {
        "config": {
          "exclude": [],
          "hash": false,
          "include": [
            "./src/**/*.{ts,tsx,jsx}",
          ],
          "name": "__bamboo.config__",
          "preflight": true,
          "presets": [
            "@bamboocss/dev/presets",
          ],
          "theme": {
            "extend": {
              "tokens": {
                "fontSizes": {
                  "100xl": {
                    "value": "220px",
                  },
                  "some-size": {
                    "value": "clamp(.75rem, 1.5vw, 1rem)",
                  },
                },
              },
            },
          },
        },
        "dependencies": [
          "packages/cli/dist/index.mjs",
          "packages/config/__tests__/samples/common/tokens.ts",
          "packages/config/__tests__/samples/mjs/bamboo.config.mjs",
        ],
      }
    `)
  })
})

/**
 * Loading, as opposed to bundling. Each case is a throwaway project outside the checkout, so no
 * temporary file a load writes beside a config can be read by an unrelated test.
 */
describe('load config', () => {
  const projects: string[] = []

  const project = (files: Record<string, string>) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-config-')))
    projects.push(root)
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    return root
  }

  afterEach(() => {
    for (const root of projects.splice(0)) rmSync(root, { recursive: true, force: true })
    delete (globalThis as any).__bambooConfigRuns
  })

  test('reports the error the config throws, having run it once', async () => {
    const root = project({
      'bamboo.config.ts': [
        `import { readFileSync } from 'node:fs'`,
        `;(globalThis as any).__bambooConfigRuns = ((globalThis as any).__bambooConfigRuns ?? 0) + 1`,
        `readFileSync('/definitely/not/a/bamboo/file.txt')`,
        `export default {}`,
      ].join('\n'),
    })

    // It used to be replaced by `node-eval`'s own `Please pass in filename to use require`,
    // after a second evaluation of the config.
    await expect(bundle(join(root, 'bamboo.config.ts'), root)).rejects.toThrow(/ENOENT/)
    expect((globalThis as any).__bambooConfigRuns).toBe(1)
  })

  test('gives a CommonJS config its own `import.meta.url`, `__dirname` and `__filename`', async () => {
    const root = project({
      'bamboo.config.ts': `export default { url: import.meta.url, dir: import.meta.dirname, cjs: [__dirname, __filename] }`,
    })
    const file = join(root, 'bamboo.config.ts')

    const { config } = await bundle<any>(file, root)

    expect(config).toEqual({ url: pathToFileURL(file).href, dir: root, cjs: [root, file] })
  })

  test('gives each file a config imports its own `import.meta.url`', async () => {
    const root = project({
      'theme/where.ts': `export const where = import.meta.url`,
      'bamboo.config.ts': `import { where } from './theme/where'\nexport default { where }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config.where).toBe(pathToFileURL(join(root, 'theme/where.ts')).href)
  })

  test('loads an ES module config, with top-level `await`, and leaves nothing behind', async () => {
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'bamboo.config.ts': `const value = await Promise.resolve('awaited')\nexport default { value, url: import.meta.url }`,
    })
    const file = join(root, 'bamboo.config.ts')

    const { config } = await bundle<any>(file, root)

    expect(config).toEqual({ value: 'awaited', url: pathToFileURL(file).href })
    // With no `node_modules` to hold it, imported from the system's temporary directory — no
    // `node_modules` is made for it — and removed once loaded.
    expect(readdirSync(root).sort()).toEqual(['bamboo.config.ts', 'package.json'])
  })

  test('imports an ES module bundle from `.bamboo` in `node_modules`, and leaves it empty', async () => {
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/.keep': '',
      'bamboo.config.ts': `export default { loaded: true }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ loaded: true })
    expect(readdirSync(join(root, 'node_modules', '.bamboo'))).toEqual([])
  })

  test('inlines a CommonJS package requiring a built-in, in an ES module config', async () => {
    // Inlined into an ESM bundle, that `require` became a call that throws `Dynamic require of
    // "node:path" is not supported` until the bundle was given a real one.
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/installed-lib/package.json': JSON.stringify({ name: 'installed-lib', main: 'index.js' }),
      'node_modules/installed-lib/index.js': `const { sep } = require('node:path')\nmodule.exports = { sep }`,
      'bamboo.config.ts': [
        // A config's own `require` beside the bundle's.
        `import { createRequire } from 'node:module'`,
        `import lib from 'installed-lib'`,
        `const require = createRequire(import.meta.url)`,
        `export default { sep: lib.sep, own: require('node:path').sep }`,
      ].join('\n'),
    })

    const { config, dependencies } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ sep, own: sep })
    expect(dependencies.sort()).toEqual(['bamboo.config.ts', 'node_modules/installed-lib/index.js'])
  })

  test('a module with no default export is its exports, as a plain object', async () => {
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'bamboo.config.ts': `export const include = ['./src/**/*.ts']`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    // An ES module namespace cannot be written to, and the loader sets defaults on the config.
    expect(Object.isExtensible(config)).toBe(true)
    expect(config).toEqual({ include: ['./src/**/*.ts'] })
  })

  // A function or `null` was spread into `{}` or `{ default: null }`, which passed for a config
  // with nothing in it.
  test.each([
    ['a function', { 'bamboo.config.cjs': `module.exports = () => ({ preflight: true })` }],
    ['`null`', { 'package.json': JSON.stringify({ type: 'module' }), 'bamboo.config.ts': `export default null` }],
    // A helper that forgot to return its argument.
    [
      '`undefined` by default',
      { 'bamboo.config.ts': `const define = (config: object) => {}\nexport default define({})` },
    ],
  ])('a config exporting %s is refused', async (_, files) => {
    const root = project(files)
    const file = join(root, Object.keys(files).find((name) => name.startsWith('bamboo.config'))!)

    await expect(bundleConfig({ cwd: root, file })).rejects.toThrow('Config must export or return an object')
  })

  // As one written in `presets` is waited for: it was merged as an object holding nothing.
  test('a config exporting a promise of one is waited for', async () => {
    const root = project({ 'bamboo.config.cjs': `module.exports = Promise.resolve({ preflight: true })` })

    const { config } = await bundleConfig({ cwd: root, file: join(root, 'bamboo.config.cjs') })

    expect(config).toMatchObject({ preflight: true, outdir: 'styled-system' })
  })

  test('a preset named by its package exporting a promise of one is waited for', async () => {
    const root = project({
      'node_modules/promised-preset/package.json': JSON.stringify({ name: 'promised-preset', main: 'index.js' }),
      'node_modules/promised-preset/index.js': `module.exports = Promise.resolve({ theme: { tokens: { colors: { x: { value: 'red' } } } } })`,
    })

    const config = await getResolvedConfig({ presets: ['promised-preset'] }, root)

    expect(config.theme?.tokens?.colors).toMatchObject({ x: { value: 'red' } })
  })

  test('a preset written in `presets` that is not an object is refused', async () => {
    await expect(getResolvedConfig({ presets: [Promise.resolve(null) as never] }, tmpdir())).rejects.toThrow(
      'A preset must be an object',
    )
  })

  test.each([
    ['`null`', `module.exports = null`],
    ['a function', `module.exports = function preset() {}`],
  ])('a preset named by its package exporting %s is refused, by name', async (_, source) => {
    const root = project({
      'node_modules/odd-preset/package.json': JSON.stringify({ name: 'odd-preset', main: 'index.js' }),
      'node_modules/odd-preset/index.js': source,
    })

    await expect(getResolvedConfig({ presets: ['odd-preset'] }, root)).rejects.toThrow(
      'Preset `odd-preset` must export an object',
    )
  })

  // A CommonJS file inlined into an ES module bundle has the banner's `require`, which resolved from
  // the temporary bundle: a relative `require.resolve` found nothing. It resolves from the config,
  // as the CommonJS bundle, compiled as the config, always has.
  test.each(['module', 'commonjs'])('resolves `require` from the config under `"type": "%s"`', async (type) => {
    const root = project({
      'package.json': JSON.stringify({ type }),
      'node_modules/.keep': '',
      'tokens.json': '{}',
      'lib/where.cjs': `exports.tokens = require.resolve('./tokens.json')`,
      'bamboo.config.ts': `import where from './lib/where.cjs'\nexport default { ...where }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ tokens: join(root, 'tokens.json') })
  })

  /**
   * A stack through the bundle names the bundle at the bundle's lines: a temporary file deleted by
   * the time anyone reads the error, or the config at lines it does not have. Where the error came
   * from is read back through the bundle's source map.
   */
  describe('says where in the source a config threw', () => {
    const files = {
      'theme/tokens.ts': [
        `export const tokens = {}`,
        ``,
        `export function boom(): never {`,
        `  throw new Error('boom')`,
        `}`,
      ],
      'bamboo.config.ts': [`import { boom } from './theme/tokens'`, ``, `boom()`, `export default {}`],
    }
    const lines = (source: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(source).map(([name, lines]) => [name, lines.join('\n')]))

    test.each(['module', 'commonjs'])('under `"type": "%s"`', async (type) => {
      const root = project({ 'package.json': JSON.stringify({ type }), ...lines(files) })

      const error = await bundle(join(root, 'bamboo.config.ts'), root).catch((error) => error)

      expect(error.message).toContain(`boom\n    at ${join(root, 'theme/tokens.ts')}:4:9`)
    })

    // The variables a file is given go into a line of its own — its first, or its directive's —
    // and a column read there is told back as the file has it.
    test.each([
      ['on its first line', [`const where = __dirname; throw new Error(where)`, `export default {}`], 1],
      [
        'after a directive',
        [`'use strict'`, `const where = __filename`, `throw new Error(where)`, `export default {}`],
        3,
      ],
    ])('in a file given its own variables, %s', async (_, source, line) => {
      const root = project({ 'bamboo.config.ts': source.join('\n') })

      const error = await bundle(join(root, 'bamboo.config.ts'), root).catch((error) => error)

      const column = source[line - 1].indexOf('new Error') + 1
      expect(error.message).toContain(`\n    at ${join(root, 'bamboo.config.ts')}:${line}:${column}`)
    })

    // The message is not a frame, though it may name the bundle, as this one does.
    test('past a message naming the bundle', async () => {
      const source = ['const where = `${__filename}:1:1`', 'throw new Error(where)', 'export default {}']
      const root = project({ 'bamboo.config.ts': source.join('\n') })
      const file = join(root, 'bamboo.config.ts')

      const error = await bundle(file, root).catch((error) => error)

      expect(error.message).toBe(`💥 Failed to load ${file}: ${file}:1:1\n    at ${file}:2:7`)
    })

    // An installed package checking what it was given raises the error there, and the config's
    // own line is the one that says what to change.
    test('in an installed package, and where the config called it', async () => {
      const library = ['exports.check = (options) => {', "  if (!options.ok) throw new Error('not ok')", '}']
      const root = project({
        'node_modules/checked/package.json': JSON.stringify({ name: 'checked', main: 'index.js' }),
        'node_modules/checked/index.js': library.join('\n'),
        'bamboo.config.ts': [`import { check } from 'checked'`, `check({})`, `export default {}`].join('\n'),
      })

      const error = await bundle(join(root, 'bamboo.config.ts'), root).catch((error) => error)

      const column = library[1].indexOf('new Error') + 1
      expect(error.message).toContain(
        `not ok\n    at ${join(root, 'node_modules/checked/index.js')}:2:${column}\n    at ${join(root, 'bamboo.config.ts')}:2:1`,
      )
    })

    // Between the frame an installed module's error was made in, as the module first ran, and the
    // config's that imported it, is code esbuild wrote, which maps to nothing: it is passed over.
    test('past a frame esbuild wrote', async () => {
      const root = project({
        'node_modules/early/package.json': JSON.stringify({ name: 'early', main: 'index.js' }),
        'node_modules/early/index.js': `const ERR = new Error('early')\nexports.fail = () => { throw ERR }`,
        'bamboo.config.ts': [`import { fail } from 'early'`, `fail()`, `export default {}`].join('\n'),
      })

      const error = await bundle(join(root, 'bamboo.config.ts'), root).catch((error) => error)

      expect(error.message).toContain(
        `early\n    at ${join(root, 'node_modules/early/index.js')}:1:13\n    at ${join(root, 'bamboo.config.ts')}:1:`,
      )
    })

    // The stack of another error, written into the message, is no part of this one's.
    test('not from a stack held in its message', async () => {
      const source = [
        `const inner = () => new Error('inner')`,
        `const held = inner().stack`,
        `throw new Error('wrapped: ' + held)`,
        `export default {}`,
      ]
      const root = project({ 'bamboo.config.ts': source.join('\n') })
      const file = join(root, 'bamboo.config.ts')

      const error = await bundle(file, root).catch((error) => error)

      expect(error.message).toBe(`💥 Failed to load ${file}: ${error.cause.message}\n    at ${file}:3:7`)
    })

    // Bundled again for its map, the config is no longer what ran: a map of other code would
    // point at the wrong line, so none is given.
    test('not once a file it imports has changed', async () => {
      const root = project({
        'theme.ts': `export const size = 1`,
        'bamboo.config.ts': [
          `import { writeFileSync } from 'node:fs'`,
          `import { size } from './theme'`,
          `writeFileSync(__dirname + '/theme.ts', 'export const size = 22')`,
          `throw new Error('boom ' + size)`,
        ].join('\n'),
      })
      const file = join(root, 'bamboo.config.ts')

      const error = await bundle(file, root).catch((error) => error)

      expect(error.message).toBe(`💥 Failed to load ${file}: boom 1`)
    })

    test('for a thrown value whose traps all throw', async () => {
      const root = project({ 'bamboo.config.ts': `throw new Proxy({}, { get() { throw new Error('trap') } })` })
      const file = join(root, 'bamboo.config.ts')

      const error = await bundle(file, root).catch((error) => error)

      expect(error.message).toBe(`💥 Failed to load ${file}: object`)
    })

    test('for a thrown value with no `toString` of its own', async () => {
      const root = project({ 'bamboo.config.ts': `throw Object.create(null)` })
      const file = join(root, 'bamboo.config.ts')

      const error = await bundle(file, root).catch((error) => error)

      expect(error.message).toBe(`💥 Failed to load ${file}: [object Object]`)
    })

    // Named for the file it bundles, so a stack through a preset's does not read as the config's.
    test('in a preset loaded by its package', async () => {
      const root = project({
        'node_modules/esm-preset/package.json': JSON.stringify({
          name: 'esm-preset',
          type: 'module',
          main: 'preset.js',
        }),
        'node_modules/esm-preset/preset.js': `throw new Error('preset')`,
      })

      const error = await bundle('esm-preset', root).catch((error) => error)

      expect(error.message).toContain(`\n    at ${join(root, 'node_modules/esm-preset/preset.js')}:1:7`)
      expect(error.cause.stack).toContain('preset.js.timestamp-')
    })
  })

  // One it cannot remove — another process's, a directory — leaves the rest to be.
  test('removes the old bundles in `.bamboo` past one it cannot remove', async () => {
    const left = (name: string) => join(root, 'node_modules/.bamboo', name)
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/.bamboo/bamboo.config.ts.timestamp-1-0a.mjs': '',
      'node_modules/.bamboo/bamboo.config.ts.timestamp-1-0b.mjs': '',
      'bamboo.config.ts': `export default {}`,
    })
    mkdirSync(left('bamboo.config.ts.timestamp-0-00.mjs'))
    const old = Date.now() / 1000 - 2 * 3600
    for (const name of readdirSync(join(root, 'node_modules/.bamboo'))) utimesSync(left(name), old, old)

    await bundle(join(root, 'bamboo.config.ts'), root)

    expect(readdirSync(join(root, 'node_modules/.bamboo'))).toEqual(['bamboo.config.ts.timestamp-0-00.mjs'])
  })

  test('removes the bundles a stopped load left in `.bamboo` once they are old', async () => {
    const left = (name: string) => join(root, 'node_modules/.bamboo', name)
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/.bamboo/bamboo.config.ts.timestamp-1-0a.mjs': '',
      'node_modules/.bamboo/bamboo.config.ts.timestamp-2-0b.mjs': '',
      'node_modules/.bamboo/kept.mjs': '',
      'bamboo.config.ts': `export default {}`,
    })
    const old = Date.now() / 1000 - 2 * 3600
    utimesSync(left('bamboo.config.ts.timestamp-1-0a.mjs'), old, old)
    utimesSync(left('kept.mjs'), old, old)

    await bundle(join(root, 'bamboo.config.ts'), root)

    // Kept: one a load in another process may still be importing, and anything not a bundle.
    expect(readdirSync(join(root, 'node_modules/.bamboo')).sort()).toEqual([
      'bamboo.config.ts.timestamp-2-0b.mjs',
      'kept.mjs',
    ])
  })

  test('a string continued on the next line is not taken for a directive', async () => {
    const root = project({
      'list.js': `'a,b'\n  .split(',')\n  .forEach((name) => (exports[name] = __dirname.length > 0))`,
      'bamboo.config.ts': `import { a, b } from './list'\nexport default { a, b }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ a: true, b: true })
  })

  test('loads a preset named by its package', async () => {
    // A string preset reaches `bundle` as the bare name, resolved from the project.
    const root = project({
      'node_modules/named-preset/package.json': JSON.stringify({ name: 'named-preset', main: 'index.js' }),
      'node_modules/named-preset/index.js': `module.exports = { name: 'named-preset' }`,
    })

    const { config } = await bundle<any>('named-preset', root)

    expect(config).toEqual({ name: 'named-preset' })
  })

  test("resolves a workspace package's own dependency from the package", async () => {
    // pnpm's strict layout: `only-here` is installed for `ui` and is not reachable from the
    // config's directory, so it has to be loaded from where `ui` resolved it.
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'packages/ui/package.json': JSON.stringify({ name: 'ui', main: 'index.ts' }),
      'packages/ui/index.ts': `import dep from 'only-here'\nexport const value: string = dep.value`,
      'packages/ui/node_modules/only-here/package.json': JSON.stringify({ name: 'only-here', main: 'index.js' }),
      'packages/ui/node_modules/only-here/index.js': `module.exports = { value: 'from ui' }`,
      'bamboo.config.ts': `import { value } from 'ui'\nexport default { value }`,
    })
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/ui'), 'junction')

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ value: 'from ui' })
  })

  test('bundles an installed package that ships TypeScript', async () => {
    // Node will not strip types under `node_modules`, so this one cannot be left to it.
    const root = project({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/ts-preset/package.json': JSON.stringify({ name: 'ts-preset', main: 'index.ts' }),
      'node_modules/ts-preset/index.ts': `export const tone: string = 'typed'`,
      'bamboo.config.ts': `import { tone } from 'ts-preset'\nexport default { tone }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ tone: 'typed' })
  })

  test("keeps a bundled file's `'use strict'` a directive", async () => {
    // The per-file variables go after the prologue, licence comment and all.
    const root = project({
      'strict.js': `/*! licence */\n'use strict'\nmodule.exports = (function () { return this === undefined })()`,
      'bamboo.config.ts': `import strict from './strict'\nexport default { strict }`,
    })

    const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root)

    expect(config).toEqual({ strict: true })
  })

  /**
   * A solution-style `tsconfig.json` — `"files": []` and `references` — declares no `paths`: they
   * are in the projects it references, as `create vite` lays them out. esbuild found the root by
   * walking up from the config, and with it no aliases, so a config importing through one failed
   * to bundle.
   */
  describe('through the paths of a referenced project', () => {
    const solution = (app: object, files: Record<string, string> = {}) =>
      project({
        'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
        'tsconfig.app.json': JSON.stringify(app),
        'src/theme/tokens.ts': `export const tokens = { colors: { brand: { value: '#2f81f7' } } }`,
        'bamboo.config.ts': `import { tokens } from '@/theme/tokens'\nexport default { theme: { tokens } }`,
        ...files,
      })
    const brand = { theme: { tokens: { colors: { brand: { value: '#2f81f7' } } } } }

    test('a config beside the root, in no project', async () => {
      const root = solution({ include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } })

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    test('with the paths a project extends', async () => {
      const root = solution(
        { extends: './tsconfig.paths.json', include: ['src'] },
        {
          'tsconfig.paths.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    test('through a reference of a reference', async () => {
      const root = project({
        'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.web.json' }] }),
        'tsconfig.web.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
        'tsconfig.app.json': JSON.stringify({ include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        'src/theme/tokens.ts': `export const tokens = { colors: { brand: { value: '#2f81f7' } } }`,
        'bamboo.config.ts': `import { tokens } from '@/theme/tokens'\nexport default { theme: { tokens } }`,
      })

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // TypeScript checks the config under the project including it, and with that project's
    // aliases alone: one only another project declares is not the config's to import through.
    test('the project that includes the config, and none of another', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
          }),
          'tsconfig.node.json': JSON.stringify({
            include: ['bamboo.config.ts'],
            compilerOptions: { paths: { '~/*': ['./src/*'] } },
          }),
        },
      )
      const file = join(root, 'bamboo.config.ts')

      await expect(bundle(file, root, { projectReferences: true })).rejects.toThrow(
        /Could not resolve "@\/theme\/tokens"/,
      )

      writeFileSync(file, `import { tokens } from '~/theme/tokens'\nexport default { theme: { tokens } }`)
      await expect(bundle<any>(file, root, { projectReferences: true })).resolves.toMatchObject({ config: brand })
    })

    test('the project that includes it through a nested solution', async () => {
      const root = project({
        'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.web.json' }] }),
        'tsconfig.web.json': JSON.stringify({
          files: [],
          references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
        }),
        'tsconfig.app.json': JSON.stringify({ include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        'tsconfig.node.json': JSON.stringify({
          include: ['bamboo.config.ts'],
          compilerOptions: { paths: { '~/*': ['./src/*'] } },
        }),
        'src/theme/tokens.ts': `export const tokens = { colors: { brand: { value: '#2f81f7' } } }`,
        'bamboo.config.ts': `import { tokens } from '~/theme/tokens'\nexport default { theme: { tokens } }`,
      })

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // Only the aliases come from a project the config is not in: its other options are the
    // project's. Under its `verbatimModuleSyntax`, an import the config never uses would be kept.
    test("not with the rest of that project's options", async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { verbatimModuleSyntax: true, paths: { '@/*': ['./src/*'] } } },
        {
          'src/theme/unused.ts': `export const unused = 1`,
          'bamboo.config.ts': `import { tokens } from '@/theme/tokens'\nimport { unused } from '@/theme/unused'\nexport default { theme: { tokens } }`,
        },
      )

      const { config, dependencies } = await bundle<any>(join(root, 'bamboo.config.ts'), root, {
        projectReferences: true,
      })

      expect(config).toEqual(brand)
      expect(dependencies.filter((file) => file.endsWith('unused.ts'))).toEqual([])
    })

    // Each file through the project including it, as TypeScript reads it: a file the config imports
    // from `tsconfig.app.json` imports through that project's aliases, not the config's.
    test("a file it imports through that file's own project", async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
          }),
          'tsconfig.node.json': JSON.stringify({
            include: ['bamboo.config.ts'],
            compilerOptions: { paths: { '~/*': ['./src/*'] } },
          }),
          'src/theme/brand.ts': `export const brand = { value: '#2f81f7' }`,
          'src/theme/tokens.ts': `import { brand } from '@/theme/brand'\nexport const tokens = { colors: { brand } }`,
          'bamboo.config.ts': `import { tokens } from '~/theme/tokens'\nexport default { theme: { tokens } }`,
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // esbuild's `tsconfig` option would have read every file under one tsconfig, this package's too.
    test('a package it imports through the tsconfig of its own', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'packages/tokens/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@tokens/*': ['./lib/*'] } } }),
          'packages/tokens/lib/brand.ts': `export const brand = { value: '#2f81f7' }`,
          'packages/tokens/src/index.ts': `import { brand } from '@tokens/brand'\nexport const tokens = { colors: { brand } }`,
          'bamboo.config.ts': `import { tokens } from './packages/tokens/src/index'\nexport default { theme: { tokens } }`,
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // The first project declaring aliases need not be the one whose aliases reach the file.
    test('a config in no project, through whichever project reaches the file', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.e2e.json' }, { path: './tsconfig.app.json' }],
          }),
          'tsconfig.e2e.json': JSON.stringify({ include: ['e2e'], compilerOptions: { paths: { '@/*': ['./e2e/*'] } } }),
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // A JavaScript config is in the project that includes it with `allowJs`, as a TypeScript one is.
    test('a JavaScript config, through the project including it and none of another', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
          }),
          'tsconfig.node.json': JSON.stringify({
            include: ['bamboo.config.mjs'],
            compilerOptions: { allowJs: true, paths: { '~/*': ['./src/*'] } },
          }),
          'bamboo.config.mjs': `import { tokens } from '@/theme/tokens'\nexport default { theme: { tokens } }`,
        },
      )
      const file = join(root, 'bamboo.config.mjs')

      await expect(bundle(file, root, { projectReferences: true })).rejects.toThrow(
        /Could not resolve "@\/theme\/tokens"/,
      )

      writeFileSync(file, `import { tokens } from '~/theme/tokens'\nexport default { theme: { tokens } }`)
      await expect(bundle<any>(file, root, { projectReferences: true })).resolves.toMatchObject({ config: brand })
    })

    // A file a project includes resolves through that project, whatever the root declares.
    test("a file it imports through its project's aliases, beside a root declaring others", async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            extends: './tsconfig.base.json',
            references: [{ path: './tsconfig.app.json' }],
          }),
          'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@workspace/*': ['./packages/*'] } } }),
          'src/theme/brand.ts': `export const brand = { value: '#2f81f7' }`,
          'src/theme/tokens.ts': `import { brand } from '@/theme/brand'\nexport const tokens = { colors: { brand } }`,
          'bamboo.config.ts': `import { tokens } from './src/theme/tokens'\nexport default { theme: { tokens } }`,
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // Not a `baseUrl` alone: it would put a directory of the project ahead of every package.
    test("a config in no project, through no other project's baseUrl", async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { baseUrl: '.' } },
        {
          'node_modules/utils/package.json': JSON.stringify({ name: 'utils', main: 'index.js' }),
          'node_modules/utils/index.js': `exports.where = 'package'`,
          'utils/index.ts': `export const where = 'project'`,
          'bamboo.config.ts': `import { where } from 'utils'\nexport default { where }`,
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual({ where: 'package' })
    })

    // Aliases the root declares itself are read by esbuild, as they always were.
    test('a root declaring aliases of its own', async () => {
      const root = solution(
        { include: ['src'] },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.app.json' }],
            compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
          }),
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // esbuild names an importer by its real path, which is not where the projects were read for a
    // config found through a symlinked directory.
    test('for an importer named by its real path', async () => {
      const root = solution({ include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } })
      const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-config-link-'))), 'project')
      projects.push(dirname(link))
      symlinkSync(root, link, 'junction')

      const aliases = await resolveSolutionAliases(join(link, 'bamboo.config.ts'), link)

      expect(aliases?.candidates('@/theme/tokens', join(root, 'bamboo.config.ts'))).toEqual([
        join(link, 'src/theme/tokens'),
      ])
      expect(aliases?.candidates('@/theme/tokens', join(link, 'bamboo.config.ts'))).toEqual([
        join(link, 'src/theme/tokens'),
      ])
    })

    // A root that compiles the config itself — no `files` or `include`, so everything — is the
    // config's project, whatever it references, and declares no aliases.
    test('not past a root that is not solution-style', async () => {
      const root = project({
        'tsconfig.json': JSON.stringify({ references: [{ path: './lib' }] }),
        'lib/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['../src/*'] } } }),
        'src/theme/tokens.ts': `export const tokens = { colors: { brand: { value: '#2f81f7' } } }`,
        'bamboo.config.ts': `import { tokens } from '@/theme/tokens'\nexport default { theme: { tokens } }`,
      })

      await expect(bundle(join(root, 'bamboo.config.ts'), root, { projectReferences: true })).rejects.toThrow(
        /Could not resolve "@\/theme\/tokens"/,
      )
    })

    // A reference whose `extends` names a package that is not installed is no reason to fail.
    test('past a reference that does not parse', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }],
          }),
          'tsconfig.node.json': JSON.stringify({ extends: '@tsconfig/not-installed', include: ['vite.config.ts'] }),
        },
      )

      const { config } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(config).toEqual(brand)
    })

    // Moving an alias, or adding the project that declares it, changes what the config imports.
    test('depending on the tsconfigs consulted, and on a reference not there yet', async () => {
      const root = solution(
        { include: ['src'], compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        {
          'tsconfig.json': JSON.stringify({
            files: [],
            references: [{ path: './tsconfig.missing.json' }, { path: './tsconfig.app.json' }],
          }),
        },
      )

      const { dependencies } = await bundle<any>(join(root, 'bamboo.config.ts'), root, { projectReferences: true })

      expect(dependencies).toEqual(
        expect.arrayContaining(['tsconfig.json', 'tsconfig.app.json', 'tsconfig.missing.json']),
      )
    })
  })
})
