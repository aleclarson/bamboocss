import rule, { RULE_NAME } from '../src/rules/no-hardcoded-color'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

const source = (call: string) => multiline`
  import { css, cva, sva } from './bamboo/css';
  import { button } from './bamboo/recipes';

  const styles = ${call}`

const invalid = (code: string, ...colors: string[]) => ({
  code,
  errors: colors.map((color) => ({ data: { color }, messageId: 'invalidColor' as const })),
})

/**
 * A value under a condition is judged as the same value written plain: what the rule reports in
 * `color: '#ef4444'` it reports in `color: { base: '#ef4444' }` and deeper, and nothing else.
 */
const VALUES: Array<[value: string, hardcoded: boolean]> = [
  ['#ef4444', true],
  ['rgb(0, 0, 0)', true],
  ['red.100', false],
  ['red.100/30', false],
  ['token(colors.red.100)', false],
]

const FORMS = [
  (value: string) => `css({ color: '${value}' })`,
  (value: string) => `css({ color: { base: '${value}' } })`,
  (value: string) => `css({ color: { _hover: { md: '${value}' } } })`,
  (value: string) => `css({ _hover: { color: { base: '${value}' } } })`,
]

const JUDGED = VALUES.flatMap(([value, hardcoded]) =>
  FORMS.map((form) => ({ code: source(form(value)), hardcoded, value })),
)

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: '#FEE2E2' })`,
      errors: [{ messageId: 'invalidColor' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red.100/30' })`,
      errors: [{ messageId: 'invalidColor' }],
      options: [{ noOpacity: true, whitelist: [] }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ background: 'rgb(134, 239, 172)' })} />;
  }`,
      errors: [{ messageId: 'invalidColor' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ _hover: {  borderColor: 'hsl(220deg, 14%, 96%)' } })} />;
  }`,
      errors: [{ messageId: 'invalidColor' }],
    },

    ...JUDGED.filter(({ hardcoded }) => hardcoded).map(({ code, value }) => invalid(code, value)),

    // Every value of the property, whichever condition it is under, and only the one written out.
    invalid(source(`css({ color: { base: '#ef4444', md: '#00ff00' } })`), '#ef4444', '#00ff00'),
    invalid(source(`css({ bg: { base: 'red.100', _dark: 'rgb(0, 0, 0)' } })`), 'rgb(0, 0, 0)'),
    invalid(
      source(`css({ color: { '&:hover': '#ef4444', '@media (min-width: 10px)': '#00ff00' } })`),
      '#ef4444',
      '#00ff00',
    ),
    invalid(source('css({ color: { base: `#ef4444` } })'), '#ef4444'),
    invalid(source(`css.raw({ color: { base: '#ef4444' } })`), '#ef4444'),
    {
      ...invalid(source(`css({ color: { base: 'red.100/30' } })`), 'red.100/30'),
      options: [{ noOpacity: true, whitelist: [] }],
    },

    // A quoted key is a property like any other.
    invalid(source(`css({ 'color': '#ef4444' })`), '#ef4444'),

    // The styles of a recipe — its base, a variant's, a slot's — including those of a variant
    // whose axis is called `color`.
    invalid(source(`cva({ base: { color: { base: '#ef4444' } } })`), '#ef4444'),
    invalid(source(`cva({ variants: { tone: { loud: { color: { _hover: '#ef4444' } } } } })`), '#ef4444'),
    invalid(source(`cva({ variants: { color: { loud: { color: { base: '#ef4444' } } } } })`), '#ef4444'),
    invalid(source(`sva({ slots: ['root'], base: { root: { color: { base: '#ef4444' } } } })`), '#ef4444'),

    // A compound variant's `css` is a style; the conditions beside it choose variants.
    invalid(
      source(
        `cva({ variants: { color: { loud: {} } }, compoundVariants: [{ color: 'loud', css: { color: '#ef4444' } }] })`,
      ),
      '#ef4444',
    ),
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red.100' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red.100/30' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ background: 'green.300' })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ _hover: {  borderColor: 'gray.100' } })} />;
  }`,
    },

    ...JUDGED.filter(({ hardcoded }) => !hardcoded).map(({ code }) => ({ code })),

    // No colour property: `padding` under conditions.
    { code: source(`css({ padding: { base: '4', md: '8' } })`) },

    // A variant being chosen — by the call, `defaultVariants` — names a variant, not a colour.
    { code: source(`button({ color: 'loud' })`) },
    { code: source(`button({ color: { base: 'loud', md: 'quiet' } })`) },
    { code: source(`cva({ variants: { color: { loud: {} } }, defaultVariants: { color: 'loud' } })`) },
    { code: source(`cva({ variants: { color: { loud: {} } }, defaultVariants: { color: { base: 'loud' } } })`) },

    // A computed key is whatever the variable holds, not the variable's name.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const color = 'padding';
  const styles = css({ [color]: '4' })`,
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const color = 'padding';
  const styles = css({ [color]: { base: '4' } })`,
    },
  ],
})
