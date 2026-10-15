import rule, { RULE_NAME } from '../src/rules/no-important'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ marginLeft: '4px!' })`,
      errors: [
        {
          messageId: 'important',
          suggestions: [
            {
              messageId: 'remove',
              output: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ marginLeft: '4px' })`,
            },
          ],
        },
      ],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ background: '#111 !important' })} />;
  }`,
      errors: [
        {
          messageId: 'important',
          suggestions: [
            {
              messageId: 'remove',
              output: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ background: '#111' })} />;
  }`,
            },
          ],
        },
      ],
    },

    {
      // The build reads the keyword in any case, so the rule has to as well.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red !IMPORTANT' })`,
      errors: [
        {
          messageId: 'important',
          suggestions: [
            {
              messageId: 'remove',
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red' })`,
            },
          ],
        },
      ],
    },

    {
      // The build strips every mark that ends a value, so one fix has to remove them all.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red !important !important' })`,
      errors: [
        {
          messageId: 'important',
          suggestions: [
            {
              messageId: 'remove',
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red' })`,
            },
          ],
        },
      ],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ _hover: { position: '[absolute!]' } })} />;
  }`,
      errors: [
        {
          messageId: 'important',
          suggestions: [
            {
              messageId: 'remove',
              output: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ _hover: { position: '[absolute]' } })} />;
  }`,
            },
          ],
        },
      ],
    },
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ marginLeft: '4' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ background: 'red.100' })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  function App(){
    return <div className={css({ _hover: { position: 'absolute' } })} />;
  }`,
    },

    {
      // A `!` that is part of the value is not a mark, to the build or to this rule.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ content: '"!"' })`,
    },
  ],
})
