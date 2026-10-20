import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BambooContext } from '../src/create-context'

/**
 * A `token()` call naming no token has to be reported, as a value naming none is.
 *
 * The call returns `undefined`, and the build reads it the same way: `css({ color:
 * token('colors.nope') })` encodes `{}`, so the property is gone before anything reaches the
 * encoder — no rule, no atom for the sheet's check to read the mistake off, and no message. Only
 * the type checker could see it, and only in a typed file with the path written out. It is the
 * same mistake as `'token(colors.nope)'` written in a value, and graded by the same half of
 * `unresolvedToken`.
 *
 * Driven through a real build, as `unresolved-token-severity.test.ts` drives the value half,
 * because the lifecycle is the part that has gone wrong before: a finding that outlives the edit
 * fixing it wedges a dev server, and one that is dropped too early passes a broken build.
 */
const build = (source: string, config: object = {}) => {
  const ctx = createContext(config as any) as unknown as BambooContext
  const files: string[] = []

  const write = (path: string, text: string) => {
    const file = ctx.runtime.path.abs(ctx.config.cwd, path)
    ctx.project.addSourceFile(file, text)
    if (!files.includes(file)) files.push(file)
    return file
  }

  ctx.getFiles = () => files
  write('src/app.tsx', source)

  const run = () => {
    ctx.parseFiles()
    const sheet = ctx.createSheet()
    ctx.appendBaselineCss(sheet)
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet)
  }

  const failure = () => {
    try {
      run()
    } catch (error) {
      return error as Error & { code?: string }
    }
  }

  return { ctx, files, write, run, failure }
}

const imports = `
import { token } from 'styled-system/tokens'
import { css } from 'styled-system/css'
`

/** One-based, as the build prints it: the line and column `needle` starts at. */
const at = (source: string, needle: string) => {
  const lines = source.split('\n')
  const line = lines.findIndex((text) => text.includes(needle))
  return `${line + 1}:${lines[line]!.indexOf(needle) + 1}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a token() call naming no token', () => {
  test('fails the build by default, naming the call and where it is', () => {
    const source = `${imports}export const card = css({ color: token('colors.nope'), bg: token('colors.red.500') })`
    const { failure } = build(source)

    const error = failure()
    expect(error?.code).toBe('ERR_BAMBOO_UNRESOLVED_TOKEN')
    expect(error?.message).toMatch(/^1 `token\(\)` call\(s\) name a token that does not exist:/)
    expect(error?.message).toContain("`token('colors.nope')` names no token.")
    expect(error?.message).toContain(`At src/app.tsx:${at(source, "token('colors.nope')")}.`)
    // The one that resolves is not reported.
    expect(error?.message).not.toContain('colors.red.500')
  })

  test('still drops the property, as the runtime does', () => {
    const source = `${imports}export const card = css({ color: token('colors.nope'), bg: token('colors.red.500') })`
    const { ctx, files } = build(source)

    const result = ctx.parseFile(files[0]!)!
    expect(Array.from(result.css, (item) => item.data)).toEqual([[{ bg: 'var(--colors-red-500)' }]])
  })

  test('covers token.value(), and a call outside any style', () => {
    const source = `${imports}export const accent = token.value('colors.nope')\nexport const ring = token('sizes.nope')`
    const { failure } = build(source)

    const message = failure()?.message
    expect(message).toMatch(/^2 `token\(\)` call\(s\)/)
    expect(message).toContain("`token.value('colors.nope')` names no token.")
    expect(message).toContain("`token('sizes.nope')` names no token.")
  })

  test('reads a path the build resolved through a constant, and every branch it enumerated', () => {
    const source = `${imports}const shade = 'colors.nope'\nexport const a = (on: boolean) => css({ color: token(on ? 'colors.red.500' : shade) })`
    const { failure } = build(source)

    const message = failure()?.message
    expect(message).toMatch(/^1 `token\(\)` call\(s\)/)
    expect(message).toContain("`token('colors.nope')` names no token.")
  })

  test('counts a path both branches repeat as one call', () => {
    const source = `${imports}export const a = (on: boolean) => token(on ? 'colors.nope' : 'colors.nope')`
    const message = build(source).failure()?.message

    expect(message).toMatch(/^1 `token\(\)` call\(s\)/)
    expect(message).toMatch(/At src\/app\.tsx:\d+:\d+\.$/m)
  })

  /**
   * `o.shade` reads as the default only until a caller passes one: the spread after it may write
   * over it. That is a guess, and the path the runtime looks up is the caller's.
   */
  test('ignores a path the build only guessed', () => {
    const source = `${imports}export const a = (props: object) => {\n  const o = { shade: 'colors.nope', ...props }\n  return token(o.shade)\n}`
    expect(build(source).failure()).toBeUndefined()
  })

  test('ignores a path it cannot read, which the runtime may well resolve', () => {
    const source = `${imports}export const a = (shade: string) => css({ color: token(\`colors.\${shade}\`) })`
    expect(build(source).failure()).toBeUndefined()
  })

  /**
   * With the fallback argument retired, `token(path) ?? '#fff'` is how a path that may name nothing
   * is written — a component shared by themes that do not all declare it. Its author handled the
   * case, and a style keeps its property: `??` supplies one. Failing the build over it would fail
   * code written the way the docs say to write it.
   */
  test('leaves a call whose result is tested or defaulted, which handles the case itself', () => {
    const source = [
      imports,
      `export const a = css({ color: token('colors.brand') ?? '#fff' })`,
      `export const b = (token('colors.brand') as string | undefined) || 'red'`,
      `export const c = token('colors.brand') ? 'themed' : 'plain'`,
      `export const d = typeof token.value('colors.brand') === 'string'`,
      `export const e = !token('colors.brand')`,
      `export const f = token('colors.brand') === undefined`,
    ].join('\n')

    expect(build(source).failure()).toBeUndefined()
  })

  /** As in the browser, and as the Vite compiler writes it: `fold-token.test.ts` pins that half. */
  test('keeps the default a call naming no token falls back to', () => {
    const source = `${imports}export const a = css({ color: token('colors.brand') ?? '#fff', bg: token('colors.red.500') ?? '#fff' })`
    const { ctx, files } = build(source)

    const result = ctx.parseFile(files[0]!)!
    expect(Array.from(result.css, (item) => item.data)).toEqual([[{ color: '#fff', bg: 'var(--colors-red-500)' }]])
  })

  test('still judges the fallback, which is used as it is', () => {
    const source = `${imports}export const a = css({ color: token('colors.brand') ?? token('colors.nope') })`
    const message = build(source).failure()?.message

    expect(message).toMatch(/^1 `token\(\)` call\(s\)/)
    expect(message).toContain("`token('colors.nope')` names no token.")
  })

  /**
   * The retired fallback argument is not a path. Recorded as one, every such call in a project
   * migrating from Panda failed the build naming its fallback: `token('#fff')` names no token.
   */
  test('reads the path alone, not the retired fallback after it', () => {
    const source = `${imports}export const a = css({ color: token('colors.red.500', '#fff') })\nexport const b = token.value('colors.red.500', 'var(--x)')`
    expect(build(source).failure()).toBeUndefined()

    // And a fallback does not hide a path that names nothing.
    const broken = `${imports}export const a = css({ color: token('colors.nope', '#fff') })`
    expect(build(broken).failure()?.message).toContain("`token('colors.nope')` names no token.")
  })

  test('suggests the path one slip away, and explains an opacity the call does not read', () => {
    const source = `${imports}export const a = token('red.300')\nexport const b = token('colors.red.300/50')`
    const message = build(source).failure()?.message

    expect(message).toContain("`token('red.300')` names no token. It returns `undefined`")
    expect(message).toContain("Did you mean `token('colors.red.300')`?")
    expect(message).toContain("`token('colors.red.300/50')` names no token: the call looks the whole path up")
    expect(message).toContain("write the value `'token(colors.red.300/50)'` instead")
  })

  test('lists one mistake once, with the places it is made', () => {
    const { write, failure } = build(`${imports}export const a = token('colors.nope')`)
    write('src/b.tsx', `${imports}export const b = token('colors.nope')`)

    const message = failure()?.message
    expect(message).toMatch(/^2 `token\(\)` call\(s\)/)
    expect(message?.match(/names no token/g)).toHaveLength(1)
    expect(message).toMatch(/At src\/app\.tsx:\d+:\d+, src\/b\.tsx:\d+:\d+\./)
  })

  /** One error for every missing token, however it was asked for, so a build is fixed once. */
  test('is reported with the values naming no token, in one error', () => {
    const source = `${imports}export const a = css({ border: '1px solid token(colors.nope2)', color: token('colors.nope') })`
    const message = build(source).failure()?.message

    expect(message).toMatch(/^1 style value\(s\) name a token that does not exist:/)
    expect(message).toContain('`border: token(colors.nope2)` — no such token.')
    expect(message).toContain('1 `token()` call(s) name a token that does not exist:')
  })

  test('is a warning under `warn`, once per parse of the file, and fails nothing', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const source = `${imports}export const a = token('colors.nope')`
    const { run } = build(source, { unresolvedToken: { token: 'warn' } })

    expect(run).not.toThrow()
    const warnings = spy.mock.calls.filter(([type]) => type === 'token').map(([, message]) => message)
    expect(warnings).toEqual([
      `src/app.tsx:${at(source, 'token(')} — \`token('colors.nope')\` names no token. It returns \`undefined\`, so ` +
        `whatever reads it gets nothing: in a style, the property is dropped. Check the path, or add the token to your theme.`,
    ])
  })

  test('says nothing under `off`', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build(`${imports}export const a = token('colors.nope')`, { unresolvedToken: 'off' })

    expect(run).not.toThrow()
    expect(spy.mock.calls.filter(([type]) => type === 'token')).toEqual([])
  })

  test('is graded by the token half alone, whatever the grammar half says', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { failure } = build(`${imports}export const a = token('colors.nope')`, {
      unresolvedToken: { token: 'warn', grammar: 'error' },
    })

    expect(failure()).toBeUndefined()
  })
})

describe('the finding lives as long as the call does', () => {
  test('a fix takes on the next pass of the same context, as a dev server reads it', () => {
    const { write, failure } = build(`${imports}export const a = css({ color: token('colors.nope') })`)
    expect(failure()?.code).toBe('ERR_BAMBOO_UNRESOLVED_TOKEN')

    write('src/app.tsx', `${imports}export const a = css({ color: token('colors.red.500') })`)
    expect(failure()).toBeUndefined()
  })

  test('a deleted file takes its findings with it', () => {
    const { ctx, files, failure } = build(`${imports}export const a = token('colors.nope')`)
    expect(failure()?.code).toBe('ERR_BAMBOO_UNRESOLVED_TOKEN')

    // What every watcher does on `unlink`, before it emits the sheet again.
    const [file] = files.splice(0)
    ctx.project.removeSourceFile(file!)
    ctx.forgetNativeFile(file!)
    expect(() => ctx.getCss(ctx.createSheet())).not.toThrow()
  })

  test('a file that left `include` takes its findings with it', () => {
    const { files, failure } = build(`${imports}export const a = token('colors.nope')`)
    expect(failure()?.code).toBe('ERR_BAMBOO_UNRESOLVED_TOKEN')

    files.splice(0)
    expect(failure()).toBeUndefined()
  })

  test('a file under `outdir` is not the author’s to fix, and is not reported', () => {
    const { ctx, write, failure } = build(`${imports}export const a = 1`)
    const file = write(`${ctx.config.outdir}/helpers.mjs`, `${imports}export const a = token('colors.nope')`)

    expect(failure()).toBeUndefined()
    // Read, and found: only left out of what the build reports.
    expect(ctx.parseFile(file)?.unresolvedTokenCalls).toHaveLength(1)
  })
})
