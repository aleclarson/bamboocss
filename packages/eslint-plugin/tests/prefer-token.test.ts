import rule, { RULE_NAME } from '../src/rules/prefer-token'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

/**
 * A value written out that a token holds, and only that: the token is then the suggestion, and a
 * value no token holds — `0`, `100%`, anything the theme does not cover — is nothing to report.
 */
const styles = (style: string) => `import { css } from './bamboo/css';\n\nexport const styles = css({ ${style} })`

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ padding: '1rem' })`,
      errors: [
        {
          data: { category: 'spacing', token: '4', value: '1rem' },
          messageId: 'preferToken',
          suggestions: [
            {
              data: { token: '4' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ padding: '4' })`,
            },
          ],
        },
      ],
    },
    // A number is a value too, and a template literal with nothing in it.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ fontWeight: 700, gap: \`1rem\` })`,
      errors: [
        {
          data: { category: 'fontWeights', token: 'bold', value: '700' },
          messageId: 'preferToken',
          suggestions: [
            {
              data: { token: 'bold' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ fontWeight: 'bold', gap: \`1rem\` })`,
            },
          ],
        },
        {
          data: { category: 'spacing', token: '4', value: '1rem' },
          messageId: 'preferToken',
          suggestions: [
            {
              data: { token: '4' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ fontWeight: 700, gap: '4' })`,
            },
          ],
        },
      ],
    },
    // Each token holding the value is a suggestion; the case of a hex color is not the value.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ color: '#FFF' })`,
      errors: [
        {
          data: { category: 'colors', token: 'white', value: '#FFF' },
          messageId: 'preferToken',
          suggestions: [
            {
              data: { token: 'white' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ color: 'white' })`,
            },
            {
              data: { token: 'deep.test.pool.poller' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ color: 'deep.test.pool.poller' })`,
            },
          ],
        },
      ],
    },
    // The property a value is for, however it is written: in a condition, per breakpoint, by a
    // quoted key, by its shorthand, under a selector; and `width`, whose values come from a function.
    // A value spelled otherwise is the same value: a leading zero, a hex color's long form.
    ...(
      [
        ["padding: { base: '1rem' }", "'1rem'", ['4']],
        ["padding: ['1rem']", "'1rem'", ['4']],
        ["'padding': '1rem'", "'1rem'", ['4']],
        ["p: '1rem'", "'1rem'", ['4']],
        ["_hover: { padding: '1rem' }", "'1rem'", ['4']],
        ["padding: '.25rem'", "'.25rem'", ['1']],
        ["color: '#ffffff'", "'#ffffff'", ['white', 'deep.test.pool.poller']],
        ["width: '100%'", "'100%'", ['full']],
      ] as const
    ).map(([style, written, tokens]) => ({
      code: styles(style),
      errors: [
        {
          messageId: 'preferToken' as const,
          suggestions: tokens.map((token) => ({
            data: { token },
            messageId: 'replace' as const,
            output: styles(style.replace(written, `'${token}'`)),
          })),
        },
      ],
    })),
    // The suggestion is written in the quote the value was.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ padding: "1rem" })`,
      errors: [
        {
          messageId: 'preferToken',
          suggestions: [
            {
              data: { token: '4' },
              messageId: 'replace',
              output: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ padding: "4" })`,
            },
          ],
        },
      ],
    },
    // A recipe's styles, a compound variant's `css` among them.
    (() => {
      const recipe = (base: string, gap: string) =>
        `import { cva } from './bamboo/css';\n\nexport const card = cva({ base: { padding: ${base} }, compoundVariants: [{ size: 'sm', css: { gap: ${gap} } }] })`
      const written = recipe("'1rem'", "'1rem'")
      return {
        code: written,
        errors: [
          {
            messageId: 'preferToken' as const,
            suggestions: [{ data: { token: '4' }, messageId: 'replace' as const, output: recipe("'4'", "'1rem'") }],
          },
          {
            messageId: 'preferToken' as const,
            suggestions: [{ data: { token: '4' }, messageId: 'replace' as const, output: recipe("'1rem'", "'4'") }],
          },
        ],
      }
    })(),
    // In a recipe a condition named `base` is a condition like any other.
    (() => {
      const recipe = (value: string) =>
        `import { cva } from './bamboo/css';\n\nexport const card = cva({ base: { padding: { base: ${value} } } })`
      return {
        code: recipe("'1rem'"),
        errors: [
          {
            messageId: 'preferToken' as const,
            suggestions: [{ data: { token: '4' }, messageId: 'replace' as const, output: recipe("'4'") }],
          },
        ],
      }
    })(),
  ],
  valid: [
    // A recipe's call selects variants: its argument is no style, whatever its keys are called.
    {
      code: multiline`
  import { buttonStyle } from './bamboo/recipes';

  export const button = buttonStyle({ padding: '1rem' })`,
    },
    // A keyframe's name is its own case: \`Spin\` is not the preset's \`spin\`.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ animation: 'Spin 1s linear infinite' })`,
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ padding: '4', color: 'white', margin: '0', fontWeight: 'bold' })`,
    },
    // A keyword is a value of CSS, not of the theme; a value that is a token's name is the token.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ color: 'currentColor', transitionTimingFunction: 'linear' })`,
    },
    // A variant selection names a variant: a token in its place would select none.
    {
      code: multiline`
  import { cva } from './bamboo/css';

  export const card = cva({
    variants: { zIndex: { 0: { color: 'red.400' } } },
    defaultVariants: { zIndex: 0 },
    compoundVariants: [{ fontWeight: 700, css: { color: 'red.400' } }],
  })`,
    },
    // No category, nothing to prefer.
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ content: '"1rem"' })`,
    },
    // Not bamboo's.
    { code: `export const styles = { padding: '1rem' }` },
  ],
})
