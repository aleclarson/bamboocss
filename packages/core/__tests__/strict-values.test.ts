import { createContext, createGeneratorContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * `strictValues` — "everything goes through the theme".
 *
 * This used to be `strictTokens`, and it used to be a type: every generated prop type narrowed
 * to the tokens, so a raw value stopped type-checking. Two things were wrong with that.
 *
 * It could not tell a *keyword* from a raw value. `display: 'flex'` is not reaching outside the
 * design system — `flex` is the only way to say it — so the setting handled `display` by not
 * narrowing it at all, which let `display: 'abc'` through with it.
 *
 * And it replaced a property's own vocabulary with the utility's. `transitionProperty` declares
 * the sugar `common`, `colors`, `size`, `position`, `background`, so under the old setting
 * `transitionProperty: 'color'` — a real css property name, and a `<custom-ident>` where the
 * grammar asks for one — was rejected in favour of `'colors'`, which emits seven declarations
 * instead of one. A utility adds vocabulary to a property; it does not take the property's own
 * away.
 *
 * The grammar draws the line the types could not, so both are answered by asking it.
 */
const utility = (strictValues = true) => (createGeneratorContext({ strictValues } as never) as any).utility

describe('strictValues', () => {
  test.each([
    ['a length', 'fontSize', '14px'],
    ['a viewport unit', 'minHeight', '100vh'],
    ['a literal colour', 'color', '#fff'],
    ['a composite value', 'border', '1px solid red'],
    ['a bare number', 'opacity', '0.5'],
    ['keywords beside a length', 'objectPosition', 'center 10px'],
    ['token paths side by side', 'borderColor', 'red.300 blue.300'],
    // Neither resolves inside a value of several parts, and the property takes neither.
    ['token names side by side', 'fontSize', 'sm md'],
    ['a misspelled keyword among keywords', 'objectPosition', 'centre top'],
    ['a raw value after a slash', 'background', 'red center/50%'],
  ])('asks for brackets around %s', (_label, prop, value) => {
    expect(utility().isRawValue(prop, value), `${prop}: ${value}`).toBe(true)
  })

  test.each([
    ['a token', 'color', 'red.300'],
    ['a numeric token key', 'padding', '4'],
    ['the escape hatch it asks for', 'fontSize', '[14px]'],
    ['a keyword, which is not a raw value', 'display', 'flex'],
    ['a keyword on a property that also takes tokens', 'top', 'auto'],
    ['an author identifier', 'animationName', 'fadeIn'],
    ['a css property name where the grammar asks for one', 'transitionProperty', 'color'],
    // Raw for their spaces and commas, which no keyword can be written without.
    ['keywords side by side', 'objectPosition', 'center top'],
    ['a list of keywords', 'transitionProperty', 'opacity, transform'],
    ['a list of author identifiers', 'animationName', 'fadeIn,slideUp'],
    ['keywords spaced around', 'objectPosition', ' center top\n'],
  ])('leaves %s alone', (_label, prop, value) => {
    expect(utility().isRawValue(prop, value), `${prop}: ${value}`).toBe(false)
  })

  test('says nothing at all when it is off', () => {
    expect(utility(false).isRawValue('fontSize', '14px')).toBe(false)
  })
})

describe('the report', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const build = (validation?: 'error', styles = `{ fontSize: '14px' }`) => {
    const ctx = createContext({ strictValues: true, ...(validation && { validation }) } as never) as any
    const file = ctx.runtime.path.abs(ctx.config.cwd, 'src/app.tsx')
    const write = (written: string) =>
      ctx.project.addSourceFile(
        file,
        `import { css } from 'styled-system/css'\nexport const App = () => <div className={css(${written})} />`,
      )
    write(styles)
    ctx.getFiles = () => [file]
    const run = () => {
      ctx.parseFiles()
      const sheet = ctx.createSheet()
      ctx.appendParserCss(sheet)
      return ctx.getCss(sheet)
    }
    return Object.assign(run, { write })
  }

  const reports = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((call: unknown[]) => String(call[1]).includes('raw css rather than tokens'))

  // A client and a server build emit the sheet each, and a dev server on every edit: each
  // repeated the whole list.
  test('warns about a value once per process, not once per emitted sheet', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const run = build()
    run()
    run()
    expect(reports(spy)).toHaveLength(1)
    expect(String(reports(spy)[0]![1])).toContain('`fontSize: 14px`')
  })

  // Not as though the latest were all there is.
  test('says a value added later is one more', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const run = build()
    run()
    run.write(`{ fontSize: '14px', lineHeight: '17px' }`)
    run()
    const later = String(reports(spy)[1]![1])
    expect(later).toMatch(/^1 more, of 2, style value/)
    expect(later).toContain('`lineHeight: 17px`')
    expect(later).not.toContain('`fontSize: 14px`')
  })

  // Nor does the sheet's own check, which would report a keyword the property does not take.
  test('says nothing of keywords side by side, under `validation: error` or not', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const styles = `{ objectPosition: 'center top', transitionProperty: 'opacity, transform' }`
    expect(() => build('error', styles)()).not.toThrow()
    build(undefined, styles)()
    expect(spy).not.toHaveBeenCalled()
  })

  test('fails each build that holds one, under `validation: error`', () => {
    const run = build('error')
    expect(run).toThrow(/fontSize: 14px/)
    expect(run).toThrow(/fontSize: 14px/)
  })
})
