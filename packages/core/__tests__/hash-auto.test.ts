import { createGeneratorContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * `hash: 'auto'` — readable while you are looking at them, hashed when nobody is. It is what class
 * names get when nothing says otherwise.
 *
 * A readable name costs every server render that writes it. Any of `& " ' < >` in a class — a
 * selector condition, a quoted value — sends the whole attribute through React's escaper, and the
 * names are long: on the css-in-js benchmark's product grid, readable names rendered at 65% of
 * plain React's speed and hashed ones as fast as plain React. Variables stay readable unless asked,
 * since hand-written CSS refers to them by name.
 *
 * The mode is resolved once, at context creation, and every name the sheet and the compiler
 * produce comes from that one answer — deciding it per call site is how the emitted CSS and the
 * compiled literal would come to disagree about a class.
 */
const hashOf = (config: object) => (createGeneratorContext(config as never) as any).hash

/** Without the fixture's defaults, which pin readable names for the snapshots. */
const defaultOf = (config: object = {}) => hashOf({ presets: [], outdir: 'styled-system', ...config })

describe('hash: auto', () => {
  test('hashes when nothing says this is development', () => {
    expect(hashOf({ hash: 'auto' })).toEqual({ className: true, tokens: true })
  })

  test('leaves names readable in development', () => {
    expect(hashOf({ hash: 'auto', dev: true })).toEqual({ className: false, tokens: false })
  })

  test('reads per-half, so class names and css vars can differ', () => {
    expect(hashOf({ hash: { className: 'auto', cssVar: false }, dev: true })).toEqual({
      className: false,
      tokens: false,
    })
    expect(hashOf({ hash: { className: 'auto', cssVar: true } })).toEqual({ className: true, tokens: true })
  })

  /** `dev` is about the mode, not about the setting: a plain boolean is unaffected by it. */
  test('does not touch an explicit setting', () => {
    expect(hashOf({ hash: true, dev: true })).toEqual({ className: true, tokens: true })
    expect(hashOf({ hash: false })).toEqual({ className: false, tokens: false })
  })
})

describe('the default', () => {
  test('hashes class names outside the dev server and leaves variables readable', () => {
    expect(defaultOf()).toEqual({ className: true, tokens: false })
  })

  test('leaves class names readable in the dev server', () => {
    expect(defaultOf({ dev: true })).toEqual({ className: false, tokens: false })
  })

  /** Hashing only the variables says nothing about class names, which keep their default. */
  test('a setting naming one half leaves the other at its default', () => {
    expect(defaultOf({ hash: { cssVar: true } })).toEqual({ className: true, tokens: true })
    expect(defaultOf({ hash: { cssVar: true }, dev: true })).toEqual({ className: false, tokens: true })
  })

  /** The opt-out, for a project that writes class names by hand. */
  test('hash: false keeps class names readable in production', () => {
    expect(defaultOf({ hash: false })).toEqual({ className: false, tokens: false })
    expect(defaultOf({ hash: { className: false } })).toEqual({ className: false, tokens: false })
  })
})
