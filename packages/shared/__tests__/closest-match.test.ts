import { describe, expect, test } from 'vitest'
import { closestMatch, editDistance } from '../src/closest-match'

describe('editDistance', () => {
  test.each([
    ['codgen', 'codegen', 1],
    ['cssgne', 'cssgen', 1],
    ['spec', 'spec', 0],
    ['sp', 'spec', 2],
  ])('%s to %s is %i', (a, b, edits) => {
    expect(editDistance(a, b)).toBe(edits)
  })
})

describe('closestMatch', () => {
  const commands = ['init', 'codegen', 'cssgen', 'analyze', 'debug', 'ship', 'spec', 'emit-pkg', 'mcp']

  test('a slip names the word it slipped from', () => {
    expect(closestMatch('codgen', commands)).toBe('codegen')
    // Two neighbours swapped are one slip, not two.
    expect(closestMatch('cssgne', commands)).toBe('cssgen')
  })

  test('one edit for every four characters, and always one', () => {
    // Two edits turn `sp` into `spec`, which for two letters is all of the word.
    expect(closestMatch('sp', commands)).toBeUndefined()
    // Nine letters allow two.
    expect(closestMatch('anallyzze', commands)).toBe('analyze')
  })

  test('nothing close is nothing', () => {
    expect(closestMatch('doctor', commands)).toBeUndefined()
  })

  test('a tie goes to the candidate listed first', () => {
    expect(closestMatch('ab', ['ac', 'ad'])).toBe('ac')
  })
})
