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
      // The build reads the keyword in any case, so the rule has to as well — and quotes it as written.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red !IMPORTANT' })`,
      errors: [
        {
          messageId: 'important',
          data: { keyword: '!IMPORTANT' },
          suggestions: [
            {
              messageId: 'remove',
              data: { keyword: '!IMPORTANT' },
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red' })`,
            },
          ],
        },
      ],
    },

    {
      // CSS allows whitespace inside the mark, and reads it as one.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red ! important' })`,
      errors: [
        {
          messageId: 'important',
          data: { keyword: '! important' },
          suggestions: [
            {
              messageId: 'remove',
              data: { keyword: '! important' },
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'red' })`,
            },
          ],
        },
      ],
    },

    {
      // In a fallback, the candidate that carries the mark, not a `!` in a later one.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ content: 'fallback("a" !important, "b!")' })`,
      errors: [
        {
          messageId: 'important',
          data: { keyword: '!important' },
          suggestions: [
            {
              messageId: 'remove',
              data: { keyword: '!important' },
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ content: 'fallback("a", "b!")' })`,
            },
          ],
        },
      ],
    },

    {
      // The mark the message names is the one removed: the `!important` in the string is content.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ content: '"!important" !' })`,
      errors: [
        {
          messageId: 'important',
          data: { keyword: '!' },
          suggestions: [
            {
              messageId: 'remove',
              data: { keyword: '!' },
              output: multiline`
  import { css } from './bamboo/css';

  const styles = css({ content: '"!important"' })`,
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
