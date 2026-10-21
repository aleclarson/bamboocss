import multiline from 'multiline-ts'
import rule, { RULE_NAME } from '../src/rules/prefer-shorthand-properties'
import { eslintTester } from '../test-utils'

const inCss = (styles: string) => multiline`
  import { css } from './bamboo/css';

  const styles = css(${styles})`

/**
 * `output` is what `--fix` writes back, or `null` where it declines. A longhand and its shorthand
 * are one property to the build, so a rename changes nothing it emits. `errors` is how many are
 * reported, or what each one names.
 */
const invalid = (
  code: string,
  output: null | string,
  errors: number | Array<{ longhand: string; shorthand: string }> = 1,
) => ({
  code,
  errors:
    typeof errors === 'number'
      ? Array.from({ length: errors }, () => ({ messageId: 'shorthand' as const }))
      : errors.map((data) => ({ data, messageId: 'shorthand' as const })),
  output,
})

/** Every output a fix writes, asserted to report nothing: `--fix` reruns until nothing changes. */
const FIXED_POINTS = [
  inCss(`{ ml: '4' }`),
  inCss(`{ _hover: { pos: 'absolute' } }`),
  inCss(`{ px: '4', mx: '2', end: '0' }`),
  multiline`
    import { css } from './bamboo/css';

    const background = 'red.100';
    const styles = css({ bg: background })`,
]

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    invalid(inCss(`{ marginLeft: '4' }`), inCss(`{ ml: '4' }`)),
    invalid(inCss(`{ _hover: { position: 'absolute' } }`), inCss(`{ _hover: { pos: 'absolute' } }`)),
    invalid(
      multiline`
        import { css } from './bamboo/css';

        function App(){
          return <div className={css({ background: 'red.100' })} />;
        }`,
      multiline`
        import { css } from './bamboo/css';

        function App(){
          return <div className={css({ bg: 'red.100' })} />;
        }`,
    ),

    // Of several shorthands the shortest, whatever order the config lists them in: it has
    // `paddingX` before `px`, `insetEnd` before `end`, and `mx` before `marginX`.
    invalid(
      inCss(`{ paddingInline: '4', marginInline: '2', insetInlineEnd: '0' }`),
      inCss(`{ px: '4', mx: '2', end: '0' }`),
      [
        { longhand: 'paddingInline', shorthand: 'px' },
        { longhand: 'marginInline', shorthand: 'mx' },
        { longhand: 'insetInlineEnd', shorthand: 'end' },
      ],
    ),

    // `{ background }` reads the variable `background`: renamed, it would read `bg` instead.
    invalid(
      multiline`
        import { css } from './bamboo/css';

        const background = 'red.100';
        const styles = css({ background })`,
      multiline`
        import { css } from './bamboo/css';

        const background = 'red.100';
        const styles = css({ bg: background })`,
    ),

    // Another key in the object names the property too, so the author has to say which one was
    // meant: renamed beside `bg`, it would be a duplicate key TypeScript refuses.
    invalid(inCss(`{ background: 'red.100', bg: 'blue.100' }`), null),
    invalid(inCss(`{ marginInline: '4', marginX: '2' }`), null),

    // A recipe's styles are renamed; its variants, the axis and the selections naming it, are not.
    invalid(
      multiline`
        import { cva } from './bamboo/css';

        export const card = cva({
          base: { background: 'red.100' },
          variants: { padding: { sm: { margin: '2' } } },
          compoundVariants: [{ padding: 'sm', css: { position: 'absolute' } }],
          defaultVariants: { padding: 'sm' },
        })`,
      multiline`
        import { cva } from './bamboo/css';

        export const card = cva({
          base: { bg: 'red.100' },
          variants: { padding: { sm: { m: '2' } } },
          compoundVariants: [{ padding: 'sm', css: { pos: 'absolute' } }],
          defaultVariants: { padding: 'sm' },
        })`,
      3,
    ),

    // `padding` is a property the pattern declares and its transform reads by that name.
    invalid(
      multiline`
        import { panel } from './bamboo/patterns';

        const styles = panel({ padding: '4', background: 'red.100' })`,
      multiline`
        import { panel } from './bamboo/patterns';

        const styles = panel({ padding: '4', bg: 'red.100' })`,
    ),
  ],
  valid: [
    ...FIXED_POINTS.map((code) => ({ code })),

    {
      code: inCss(`{ marginLeft: '4' }`),
      options: [{ whitelist: ['marginLeft'] }],
    },

    // A computed key names whatever its expression holds.
    {
      code: multiline`
        import { css } from './bamboo/css';

        const background = 'color';
        const styles = css({ [background]: 'red.100' })`,
    },

    // A recipe's call selects variants, whatever they are named.
    {
      code: multiline`
        import { button } from './bamboo/recipes';

        const className = button({ padding: 'sm' })`,
    },
  ],
})
