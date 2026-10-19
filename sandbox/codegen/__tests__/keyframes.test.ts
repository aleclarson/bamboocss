import { describe, expect, test } from 'vitest'
import { keyframes } from '../styled-system/css'

describe('keyframes', () => {
  test('refuses to name a block at runtime', () => {
    expect(() => keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })).toThrow('was not compiled')
  })

  test('takes stops of declarations, and no condition inside one', () => {
    const typed = () => {
      keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5, '--glow': '4px' } })
      // @ts-expect-error a stop holds declarations, which `@keyframes` cannot condition
      keyframes({ from: { _hover: { opacity: 1 } } })
    }
    expect(typed).toBeTypeOf('function')
  })
})
