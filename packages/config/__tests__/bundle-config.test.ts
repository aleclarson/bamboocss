// @vitest-environment node
// Loading an ES module config imports a file it writes, which the repo's default `happy-dom`
// environment cannot resolve outside the project: it reads modules as a browser would. A config
// is loaded in Node, so this is the environment to load one in.

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { bundle } from '../src/bundle-config'

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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
          "jsxFramework": "react",
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
    symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/ui'), 'dir')

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
})
