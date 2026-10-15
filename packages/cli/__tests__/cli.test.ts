import { execSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// Helper to run command and capture output even if it fails
function runCommand(cmd: string, options: any) {
  const opts = { ...options, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }
  try {
    return execSync(cmd, opts).toString()
  } catch (error: any) {
    // If command fails, still return the output (stdout + stderr)
    const stdout = error.stdout ? error.stdout.toString() : ''
    const stderr = error.stderr ? error.stderr.toString() : ''
    const output = stdout + stderr

    // Debug: log first 200 chars of output if test is failing
    if (process.env.DEBUG_CLI_TEST) {
      console.log('Command failed:', cmd)
      console.log('Output (first 200 chars):', output.slice(0, 200))
      console.log('stdout length:', stdout.length, 'stderr length:', stderr.length)
    }

    if (output) return output
    throw error
  }
}

describe('CLI', () => {
  const _dirname = path.dirname(fileURLToPath(import.meta.url))
  const binPath = path.resolve(_dirname, '../bin.js')

  // Keep generated `styled-system` files outside the checkout. The TypeScript compiler is
  // process-global, so resolution-ledger tests running in parallel could otherwise discover
  // this temporary package and mistake it for part of their virtual `/app` project.
  const testsCwd = mkdtempSync(path.join(tmpdir(), 'bamboo-cli-'))
  writeFileSync(path.join(testsCwd, 'tsconfig.json'), '{}')

  const packageScope = path.join(testsCwd, 'node_modules/@bamboocss')
  mkdirSync(packageScope, { recursive: true })
  symlinkSync(
    path.resolve(_dirname, '..'),
    path.join(packageScope, 'dev'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  const paths = {
    config: path.resolve(testsCwd, 'bamboo.config.ts'),
    styledSystem: path.resolve(testsCwd, 'styled-system'),
    logFile: path.resolve(testsCwd, 'bamboo.log'),
    pkgJson: path.resolve(testsCwd, 'package.json'),
  }

  afterAll(async () => {
    await fs.rm(testsCwd, { force: true, recursive: true })
  })

  test('init', async () => {
    // Clean up config file before test to ensure fresh state
    try {
      await fs.unlink(paths.config)
    } catch {
      // Ignore if file doesn't exist
    }

    const cmd = `node ${binPath} init --cwd="${testsCwd}"`

    // init
    const output = runCommand(cmd, { cwd: testsCwd })
    // Check for either "Thanks" (new config) or existing config message
    expect(output.includes('Thanks') || output.includes('It looks like you already have bamboo created')).toBe(true)

    // Check if the config file was created
    const configFileExists = await fs.access(paths.config)
    expect(configFileExists).toBeUndefined()

    // init on existing project
    const output2 = runCommand(cmd, { cwd: testsCwd })
    expect(output2.includes('It looks like you already have bamboo created')).toBe(true)

    // init with --force
    const output3 = runCommand(cmd + ' --force --logfile="./bamboo.log"', { cwd: testsCwd })
    expect(output3.includes('Bamboo initialized')).toBe(true)

    // Check if the log file was created
    const logFileExists = await fs.access(paths.logFile)
    expect(logFileExists).toBeUndefined()
  })

  /**
   * `--strict-values` used to be collected and dropped.
   *
   * cac parsed it, `interactive()` returned it, and the init action destructured everything
   * except it — so a project that asked for strict tokens got a config without the key and
   * nothing said so. The flag is documented in the CLI reference, which made it worse: the
   * only way to find out was to write a bad token and watch it not be reported.
   */
  test('init --strict-values', async () => {
    const cmd = `node ${binPath} init --cwd="${testsCwd}" --force --no-codegen`

    runCommand(`${cmd} --strict-values`, { cwd: testsCwd })
    expect(await fs.readFile(paths.config, 'utf8')).toContain('strictValues: true')

    // Absent unless asked for. This writes a *policy* — every raw css value has to become
    // `[14px]` — and a default cannot make that decision for a team. The mistake it used to
    // exist to catch, a misspelled token, is reported by the build with no setting at all.
    runCommand(cmd, { cwd: testsCwd })
    expect(await fs.readFile(paths.config, 'utf8')).not.toContain('strictValues')

    runCommand(`${cmd} --no-strict-values`, { cwd: testsCwd })
    expect(await fs.readFile(paths.config, 'utf8')).not.toContain('strictValues')
  }, 120_000)

  test('codegen', async () => {
    const cmd = `node ${binPath} codegen --cwd="${testsCwd}"`

    // codegen
    const output = runCommand(cmd + ' --cpu-prof', { cwd: testsCwd })
    expect(output.includes('the css function to author styles')).toBe(true)

    // Check that the `styled-system` folder was created
    const styledSystemExists = await fs.access(paths.styledSystem)
    expect(styledSystemExists).toBeUndefined()

    // Check that the `styled-system/jsx` was NOT created
    await expect(fs.access(path.resolve(paths.styledSystem, 'jsx'))).rejects.toThrow()

    // Check that the `.cpuprof` file was created
    const cpuProfPath = output.split('[cpu-prof]').pop()!.trim()!
    const cpuProfExists = await fs.access(cpuProfPath)
    expect(cpuProfExists).toBeUndefined()

    await fs.unlink(cpuProfPath)
  })

  test('cssgen', async () => {
    const cmd = `node ${binPath} cssgen --cwd="${testsCwd}"`

    // cssgen
    const output = runCommand(cmd, { cwd: testsCwd })
    expect(output.includes('Successfully extracted css')).toBe(true)

    // Check that the `styled-system/styles.css` was created
    const stylesCssExists = await fs.access(path.resolve(paths.styledSystem, 'styles.css'))
    expect(stylesCssExists).toBeUndefined()

    // Check that `--outfile` is fine
    const output3 = runCommand(cmd + ' --outfile="./styles.css"', { cwd: testsCwd })
    expect(output3.includes('Successfully extracted css')).toBe(true)

    await fs.unlink(path.resolve(testsCwd, 'styles.css'))

    // Check that `--silent` is fine
    const output4 = runCommand(cmd + ' --silent', { cwd: testsCwd })
    expect(output4.trim().length).toBe(0)
  })

  test('default', async () => {
    const cmd = `node ${binPath} --cwd="${testsCwd}"`

    // default
    const output = runCommand(cmd, { cwd: testsCwd })
    expect(output.includes('Successfully extracted css')).toBe(true)

    // Check that the `styled-system` folder was created
    const styledSystemExists = await fs.access(paths.styledSystem)
    expect(styledSystemExists).toBeUndefined()

    // Check that the `styled-system/styles.css` was created
    const stylesCssExists = await fs.access(path.resolve(paths.styledSystem, 'styles.css'))
    expect(stylesCssExists).toBeUndefined()
  })

  /**
   * The default command reads its arguments as `include` globs, so a mistyped or never-defined
   * command used to match no files, build a stylesheet from nothing over the real one, and exit 0.
   * So did any glob or path matching nothing, and a glob the shell expanded built from its first
   * file alone.
   *
   * The sheet is built from real styles first, which is what makes "left alone" mean anything:
   * built from nothing, it is the same sheet a build from nothing would write.
   */
  describe('an argument naming nothing to build from', () => {
    const stylesheet = path.resolve(paths.styledSystem, 'styles.css')
    const sources = {
      red: path.resolve(testsCwd, 'src/unknown-command-red.tsx'),
      blue: path.resolve(testsCwd, 'src/unknown-command-blue.tsx'),
    }
    const run = (args: string) => {
      const { status, stdout, stderr } = spawnSync(`node ${binPath} ${args} --cwd="${testsCwd}"`, {
        cwd: testsCwd,
        shell: true,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      })
      return { status, output: stdout + stderr }
    }

    beforeAll(async () => {
      await fs.mkdir(path.dirname(sources.red), { recursive: true })
      for (const [color, source] of Object.entries(sources)) {
        await fs.writeFile(
          source,
          `import { css } from '../styled-system/css'\nexport const a = css({ color: '${color}.300' })\n`,
        )
      }

      expect(run('')).toMatchObject({ status: 0, output: expect.stringContaining('Successfully extracted css') })
      const sheet = await fs.readFile(stylesheet, 'utf8')
      expect(sheet).toContain('color: var(--colors-red-300)')
      expect(sheet).toContain('color: var(--colors-blue-300)')
    })

    afterAll(async () => {
      for (const source of Object.values(sources)) await fs.rm(source, { force: true })
    })

    test.each([
      ['codgen', '`bamboo codgen` is not a command; did you mean `bamboo codegen`?'],
      ['doctor', '`doctor` matches no files, so nothing was built, and the stylesheet was left as it was.'],
      ['./codgen', '`./codgen` matches no files'],
      [`'src/*.tsxx'`, '`src/*.tsxx` matches no files'],
      // A glob matches files, so a directory alone matches nothing.
      ['src', '`src` is a directory, and a glob matches files: write one for the files in it, like `src/**/*.tsx`.'],
      ['src/', 'like `src/**/*.tsx`.'],
    ])('`bamboo %s` is refused, and leaves the sheet alone', async (args, message) => {
      const before = await fs.readFile(stylesheet, 'utf8')
      const result = run(args)

      expect(result.status).toBe(1)
      expect(result.output).toContain(message)
      expect(await fs.readFile(stylesheet, 'utf8')).toBe(before)
    })

    test('a glob builds from every file it matches, quoted or expanded by the shell', async () => {
      for (const glob of [`'src/unknown-command-*.tsx'`, 'src/unknown-command-*.tsx']) {
        expect(run(glob)).toMatchObject({ status: 0, output: expect.stringContaining('Successfully extracted css') })
        const sheet = await fs.readFile(stylesheet, 'utf8')
        expect(sheet).toContain('color: var(--colors-red-300)')
        expect(sheet).toContain('color: var(--colors-blue-300)')
      }
    })

    test('a glob builds from what it matches, and nothing else', async () => {
      expect(run(`'src/unknown-command-red.tsx'`)).toMatchObject({ status: 0 })
      const sheet = await fs.readFile(stylesheet, 'utf8')
      expect(sheet).toContain('color: var(--colors-red-300)')
      expect(sheet).not.toContain('color: var(--colors-blue-300)')
    })
  })

  test('debug', async () => {
    const cmd = `node ${binPath} debug --cwd="${testsCwd}"`

    // debug
    const output = runCommand(cmd, { cwd: testsCwd })
    expect(output.includes('files using Bamboo')).toBe(true)

    // Check that the `styled-system/debug` folder was created
    const debugExists = await fs.access(path.resolve(paths.styledSystem, 'debug'))
    expect(debugExists).toBeUndefined()

    // Check that the `styled-system/debug/config.json` file was created
    const debugConfigExists = await fs.access(path.resolve(paths.styledSystem, 'debug/config.json'))
    expect(debugConfigExists).toBeUndefined()
  })

  test('ship', async () => {
    const cmd = `node ${binPath} ship --cwd="${testsCwd}"`

    // ship
    const output = runCommand(cmd, { cwd: testsCwd })
    expect(output.includes('files using Bamboo')).toBe(true)

    // Check that the `styled-system/bamboo.buildinfo.json` file was created
    const buildInfoExists = await fs.access(path.resolve(paths.styledSystem, 'bamboo.buildinfo.json'))
    expect(buildInfoExists).toBeUndefined()
  })

  test('emit-pkg', async () => {
    const cmd = `node ${binPath} emit-pkg --cwd="${testsCwd}"`

    // emit-pkg
    const output = runCommand(cmd, { cwd: testsCwd })
    expect(output.includes('Emit package.json')).toBe(true)

    // Check that the `package.json` file was created
    const pkgExists = await fs.access(paths.pkgJson)
    expect(pkgExists).toBeUndefined()

    // Clean up
    await fs.unlink(paths.pkgJson)
  })

  /**
   * Codegen leaves a `private` `package.json` in the outdir to carry the `sideEffects`
   * hint, so pointing `emit-pkg` at that directory finds a file already there. It still
   * has to produce a package that can be resolved and published: an entrypoint map alone,
   * on top of a `private` file with no version or license, is not one.
   */
  test('emit-pkg over the codegen output', async () => {
    const outdirPkg = path.resolve(paths.styledSystem, 'package.json')

    // The name is not decoration. Without one, a workspace glob that reaches this
    // directory takes down `pnpm install` and `changeset publish` with
    // `missing the "name" field` -- naming no directory in particular.
    expect(JSON.parse(await fs.readFile(outdirPkg, 'utf8'))).toMatchObject({
      name: 'styled-system',
      private: true,
      sideEffects: ['*.css', '**/*.css'],
    })

    runCommand(`node ${binPath} emit-pkg --outdir styled-system --cwd="${testsCwd}"`, { cwd: testsCwd })

    const pkg = JSON.parse(await fs.readFile(outdirPkg, 'utf8'))

    expect(pkg).toMatchObject({
      name: 'styled-system',
      version: '0.1.0',
      license: 'ISC',
      type: 'module',
      sideEffects: ['*.css', '**/*.css'],
      scripts: { prepare: 'bamboo codegen --clean' },
    })
    expect(pkg.exports['./css']).toBeDefined()
    expect('private' in pkg).toBe(false)
  })

  /** A file the consumer named is theirs; only the entrypoints are ours to write. */
  test('emit-pkg leaves a package the consumer named alone', async () => {
    const outdirPkg = path.resolve(paths.styledSystem, 'package.json')
    const owned = { name: '@acme/styled-system', version: '2.4.0', private: true, type: 'module' }
    await fs.writeFile(outdirPkg, JSON.stringify(owned, null, 2))

    runCommand(`node ${binPath} emit-pkg --outdir styled-system --cwd="${testsCwd}"`, { cwd: testsCwd })

    const pkg = JSON.parse(await fs.readFile(outdirPkg, 'utf8'))

    expect(pkg).toMatchObject(owned)
    expect(pkg.exports['./css']).toBeDefined()
    expect(pkg.license).toBeUndefined()
  })
})
