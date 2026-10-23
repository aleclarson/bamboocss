import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * `staticCss` is for classes the source never writes, so what applies them is markup written by
 * hand — which cannot write a hashed name. Production hashes class names unless told otherwise,
 * so a project relying on `staticCss` has to opt out, and the build is what tells it.
 */
afterEach(() => vi.restoreAllMocks())

const warnings = (config: object) => {
  const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  const ctx = createContext({ staticCss: { css: [{ properties: { color: ['red.300'] } }] }, ...config } as never)

  // A build processes `staticCss` once per output.
  ctx.staticCss.clone().process(ctx.config.staticCss!)
  ctx.staticCss.clone().process(ctx.config.staticCss!)

  return spy.mock.calls.filter(([type]) => type === 'static_css:process')
}

describe('staticCss under hashed class names', () => {
  test('warns, once per context', () => {
    expect(warnings({ hash: { className: true } })).toHaveLength(1)
  })

  test('says nothing while class names are readable', () => {
    expect(warnings({ hash: false })).toHaveLength(0)
    expect(warnings({ hash: 'auto', dev: true })).toHaveLength(0)
  })

  test('says nothing when staticCss emits no class', () => {
    expect(warnings({ hash: { className: true }, staticCss: { css: [] } })).toHaveLength(0)
  })
})
