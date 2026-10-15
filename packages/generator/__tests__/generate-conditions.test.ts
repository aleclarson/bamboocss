import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { generateConditions } from '../src/artifacts/js/conditions'

describe('generate conditions', () => {
  /**
   * An array was once read as one value per breakpoint. That reading was removed — the runtime
   * throws `INVALID_STYLE_VALUE` and the compiler fails the build — but the type kept admitting
   * one, so `fontWeight: ['bold', 'normal']` type-checked and then broke the build.
   */
  test('a conditional value is the value or a condition object, never an array', () => {
    const { dts } = generateConditions(createContext())
    const conditionalValue = dts.slice(dts.indexOf('export type ConditionalValue'), dts.indexOf('export type Nested'))

    expect(conditionalValue).toMatchInlineSnapshot(`
      "export type ConditionalValue<V> =
        | V
        | {
            [K in keyof Conditions]?: ConditionalValue<V> | undefined
          }

      "
    `)
  })

  // As a block is written under `exactOptionalPropertyTypes` when it is left out: `_hover: active ? { … } : undefined`.
  test('a nested block may be undefined', () => {
    const { dts } = generateConditions(createContext())

    expect(dts.slice(dts.indexOf('export type Nested'))).toMatchInlineSnapshot(`
      "export type Nested<P> = P & {
        [K in Selectors]?: Nested<P> | undefined
      } & {
        [K in AnySelector]?: Nested<P> | undefined
      } & {
        [K in keyof Conditions]?: Nested<P> | undefined
      }
      "
    `)
  })
})
