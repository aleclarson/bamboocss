import multiline from 'multiline-ts'
import rule, { RULE_NAME } from '../src/rules/prefer-longhand-properties'
import { eslintTester } from '../test-utils'

const inCss = (styles: string) => multiline`
  import { css } from './bamboo/css';

  const styles = css(${styles})`

/**
 * `output` is what `--fix` writes back, or `null` where it declines. A shorthand and its longhand
 * are one property to the build, so a rename changes nothing it emits.
 */
const invalid = (code: string, output: null | string, errors = 1) => ({
  code,
  errors: Array.from({ length: errors }, () => ({ messageId: 'longhand' as const })),
  output,
})

/** Every output a fix writes, asserted to report nothing: `--fix` reruns until nothing changes. */
const FIXED_POINTS = [
  inCss(`{ marginLeft: '4' }`),
  inCss(`{ _hover: { position: 'absolute' } }`),
  inCss(`{ background: 'red.100', padding: '4' }`),
  inCss(`{ marginLeft: '4' }`).replace('css(', 'css.raw('),
  multiline`
    import { css } from './bamboo/css';

    const bg = 'red.100';
    const styles = css({ background: bg })`,
]

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    invalid(inCss(`{ ml: '4' }`), inCss(`{ marginLeft: '4' }`)),
    invalid(inCss(`{ _hover: { pos: 'absolute' } }`), inCss(`{ _hover: { position: 'absolute' } }`)),
    invalid(inCss(`{ bg: 'red.100', p: '4' }`), inCss(`{ background: 'red.100', padding: '4' }`), 2),
    invalid(inCss(`{ ml: '4' }`).replace('css(', 'css.raw('), inCss(`{ marginLeft: '4' }`).replace('css(', 'css.raw(')),
    invalid(
      multiline`
        import { css } from './bamboo/css';

        function App(){
          return <div className={css({ bg: 'red.100' })} />;
        }`,
      multiline`
        import { css } from './bamboo/css';

        function App(){
          return <div className={css({ background: 'red.100' })} />;
        }`,
    ),

    // `{ bg }` reads the variable `bg`: renamed, it would read `background` instead.
    invalid(
      multiline`
        import { css } from './bamboo/css';

        const bg = 'red.100';
        const styles = css({ bg })`,
      multiline`
        import { css } from './bamboo/css';

        const bg = 'red.100';
        const styles = css({ background: bg })`,
    ),

    // Another key in the object names the property too, so renaming would write it twice — a
    // duplicate key TypeScript refuses — and which one was meant is the author's to say. However
    // the other is written, and only in that object.
    invalid(inCss(`{ bg: 'red.100', background: 'blue.100' }`), null),
    invalid(inCss(`{ bg: 'red.100', 'background': 'blue.100' }`), null),
    invalid(inCss(`{ mx: '4', marginX: '2' }`), null, 2),
    invalid(
      inCss(`{ bg: 'red.100', background: 'blue.100', _hover: { bg: 'red.200' } }`),
      inCss(`{ bg: 'red.100', background: 'blue.100', _hover: { background: 'red.200' } }`),
      2,
    ),

    // A recipe's styles are renamed; its variants, the axis and the selections naming it, are not.
    invalid(
      multiline`
        import { cva } from './bamboo/css';

        export const card = cva({
          base: { bg: 'red.100' },
          variants: { rounded: { true: { p: '4' } } },
          compoundVariants: [{ rounded: true, css: { m: '2' } }],
          defaultVariants: { rounded: true },
        })`,
      multiline`
        import { cva } from './bamboo/css';

        export const card = cva({
          base: { background: 'red.100' },
          variants: { rounded: { true: { padding: '4' } } },
          compoundVariants: [{ rounded: true, css: { margin: '2' } }],
          defaultVariants: { rounded: true },
        })`,
      3,
    ),

    // `rounded` is a property the pattern declares and its transform reads by that name.
    invalid(
      multiline`
        import { panel } from './bamboo/patterns';

        const styles = panel({ rounded: true, bg: 'red.100' })`,
      multiline`
        import { panel } from './bamboo/patterns';

        const styles = panel({ rounded: true, background: 'red.100' })`,
    ),
  ],
  valid: [
    ...FIXED_POINTS.map((code) => ({ code })),

    {
      code: inCss(`{ ml: '4' }`),
      options: [{ whitelist: ['ml'] }],
    },

    // A computed key names whatever its expression holds.
    {
      code: multiline`
        import { css } from './bamboo/css';

        const bg = 'color';
        const styles = css({ [bg]: 'red.100' })`,
    },

    // A key being destructured names what it reads, not a style.
    {
      code: inCss(`({ bg }) => bg`),
    },

    // A recipe's call selects variants, whatever they are named.
    {
      code: multiline`
        import { button } from './bamboo/recipes';

        const className = button({ rounded: true })`,
    },

    // With the JSX factory gone, an attribute is a component's prop: here, a recipe's variant.
    {
      code: multiline`
        import { Button } from './bamboo/recipes';

        const App = () => <Button rounded />`,
    },
  ],
})
