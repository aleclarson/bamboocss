import { describe, it, expect } from 'vitest'
import { createContext } from '@bamboocss/fixture'
import { Reporter } from '../src'

const ctx = createContext({
  theme: {
    tokens: {
      colors: {
        red: { 200: { value: 'red' } },
        green: { 200: { value: 'green' } },
        blue: { 200: { value: 'blue' } },
        yellow: { 200: { value: 'yellow' } },
        custom: { value: 'custom' },
      },
      fontSizes: { lg: { value: '12px' } },
      spacing: { 1: { value: '10px' }, 2: { value: '20px' } },
    },
  },
})

const reporterFor = (code: string) => {
  ctx.project.addSourceFile('code.tsx', code)
  const reporter = new Reporter(ctx, {
    parserOptions: ctx.parserOptions,
    parseFile: (file) => ctx.parseFile(file),
    prepare: (files) => ctx.prepareNativeExtraction(files),
    getRelativePath: ctx.runtime.path.relative,
    getFiles: () => ['code.tsx'],
  })
  reporter.init()
  return reporter
}

const tokenReport = (code: string) => {
  ctx.project.addSourceFile('code.tsx', code)
  const reporter = new Reporter(ctx, {
    parserOptions: ctx.parserOptions,
    parseFile: (file) => ctx.parseFile(file),
    prepare: (files) => ctx.prepareNativeExtraction(files),
    getRelativePath: ctx.runtime.path.relative,
    getFiles: () => ['code.tsx'],
  })

  reporter.init()

  const report = reporter.getTokenReport()
  return report.getSummary()
}

describe('reporter', () => {
  it('tokens / v1', () => {
    const code = `
    import {css} from "styled-system/css"

    const baseStyle = css({
        color: 'red.200',
        fontSize: '12px',
        bg: 'red.200',
    })
    `
    expect(tokenReport(code)).toMatchInlineSnapshot(`
      [
        {
          "category": "fontSizes",
          "count": 1,
          "hardcoded": 7,
          "mostUsedNames": [
            "lg",
          ],
          "percentUsed": 100,
          "usedCount": 1,
          "usedInXFiles": 1,
        },
        {
          "category": "spacing",
          "count": 6,
          "hardcoded": 3,
          "mostUsedNames": [
            "2",
          ],
          "percentUsed": 16.67,
          "usedCount": 1,
          "usedInXFiles": 0,
        },
        {
          "category": "colors",
          "count": 19,
          "hardcoded": 9,
          "mostUsedNames": [
            "red.200",
          ],
          "percentUsed": 5.26,
          "usedCount": 1,
          "usedInXFiles": 1,
        },
        {
          "category": "sizes",
          "count": 5,
          "hardcoded": 5,
          "mostUsedNames": [],
          "percentUsed": 0,
          "usedCount": 0,
          "usedInXFiles": 0,
        },
      ]
    `)
  })

  /**
   * A value keyed by a condition — `{ base, md }` — is the value of the property above it. One
   * keyed `base` was counted as a property named `base`, and one keyed `md` with no token type, so
   * a token used only at a breakpoint was reported unused. And `sva()` was never read at all.
   */
  it('counts the tokens a value names under a condition, and in sva', () => {
    const summary = tokenReport(`
    import { css, sva } from "styled-system/css"

    css({ color: { base: 'red.200', md: 'blue.200' }, _hover: { bg: { md: 'green.200' } } })
    sva({ slots: ['root'], base: { root: { color: 'yellow.200' } } })
    `)
    const colors = summary.find((entry) => entry.category === 'colors')

    expect(colors?.usedCount).toBe(4)
    expect([...(colors?.mostUsedNames ?? [])].sort()).toEqual(['blue.200', 'green.200', 'red.200', 'yellow.200'])
  })

  // An arbitrary condition is as much one as a named one.
  it('counts the token a value names under an arbitrary selector', () => {
    const summary = tokenReport(`
    import { css } from "styled-system/css"

    css({ color: { '&:hover': 'red.200', '@media (min-width: 40em)': 'blue.200' } })
    `)
    const colors = summary.find((entry) => entry.category === 'colors')

    expect([...(colors?.mostUsedNames ?? [])].sort()).toEqual(['blue.200', 'red.200'])
  })

  /**
   * A `cva()` config is read for its styles, as a config recipe is: `defaultVariants` names
   * variants, not properties, and a compound variant's `css` is styles like any other.
   */
  it('reads the styles of a cva config, and the conditions in them', () => {
    const { report } = reporterFor(`
    import { cva } from "styled-system/css"

    export const card = cva({
      base: { _hover: { color: 'red.200' } },
      variants: { size: { sm: { fontSize: 'lg' } } },
      compoundVariants: [{ size: 'sm', css: { color: 'green.200' } }],
      defaultVariants: { size: 'sm' },
    })
    `)
    const [, maps] = [...report.derived.byFilePathMaps].find(([file]) => file.endsWith('code.tsx'))!
    const { byPropertyName, byConditionName, byTokenName } = maps

    expect([...byPropertyName.keys()].sort()).toEqual(['color', 'fontSize'])
    expect([...byConditionName.keys()]).toEqual(['_hover'])
    expect(byTokenName.has('green.200')).toBe(true)
  })

  /**
   * A value nested under a condition in a config recipe is a use like any other.
   *
   * The report used to walk config recipes and global css through boxes that stopped one
   * level down, so `_hover: { color: 'darkblue' }` in a recipe was never counted, while the
   * same shape at a call site was. The walk is over plain objects now, at every depth.
   */
  it('counts values nested under conditions in config recipes', () => {
    const nested = createContext({
      theme: {
        tokens: { colors: { brand: { value: 'blue' } } },
        extend: {
          recipes: {
            probe: {
              className: 'probe',
              base: { _hover: { color: 'brand' }, '&[data-x]': { background: 'hotpink' } },
            },
          },
        },
      },
    })
    const reporter = new Reporter(nested, {
      parserOptions: nested.parserOptions,
      parseFile: (file) => nested.parseFile(file),
      prepare: (files) => nested.prepareNativeExtraction(files),
      getRelativePath: nested.runtime.path.relative,
      getFiles: () => [],
    })
    reporter.init()

    const colors = reporter.getTokenReport().usageMap.get('colors') ?? []
    const probe = colors.filter((usage) => usage.filePath === '@config/theme/recipes/probe')

    expect(probe.map((usage) => [usage.value, usage.type])).toEqual([
      ['brand', 'token'],
      ['hotpink', 'nonToken'],
    ])
  })
})
