import { expect, test } from 'vitest'
import { css } from '../styled-system/css'
import type {
  SystemStyleObject,
  SystemStyleObjectWith,
  SystemStyleObjectWithout,
} from '../styled-system/types/system-types'

/**
 * A style object restricted to some properties, as Panda 2 has it: for a component that lets its
 * caller style part of it. Enforced by `pnpm codegen typecheck`: an unused `@ts-expect-error` is
 * itself an error, so each rejection below is one the types make.
 */
const accept = <T>(value: T) => value

type ButtonCss = SystemStyleObjectWith<'margin' | 'marginTop' | 'width'>
type CardCss = SystemStyleObjectWithout<'color' | 'background'>

test('a restricted style object takes its properties alone, in every condition too', () => {
  const button = [
    accept<ButtonCss>({ marginTop: '4' }),
    accept<ButtonCss>({ marginTop: { base: '4', md: '8' } }),
    accept<ButtonCss>({ _hover: { marginTop: '8' } }),
    accept<ButtonCss>({ '& > *': { width: 'full' } }),
    accept<ButtonCss>({ md: { _hover: { width: 'full' } } }),
    // @ts-expect-error color is not one of its properties
    accept<ButtonCss>({ color: 'red.500' }),
    // @ts-expect-error nor inside a condition
    accept<ButtonCss>({ _hover: { color: 'red.500' } }),
    // @ts-expect-error base is no top-level key, as for any style object
    accept<ButtonCss>({ base: { marginTop: '4' } }),
  ]
  const card = [
    accept<CardCss>({ padding: '4', _dark: { padding: '6' } }),
    // @ts-expect-error color is left out
    accept<CardCss>({ color: 'red.500' }),
    // @ts-expect-error inside a condition too
    accept<CardCss>({ _dark: { color: 'red.500' } }),
  ]

  // Each is a style object, so it goes into css() as one.
  const asStyles: SystemStyleObject[] = [...button, ...card]
  expect(asStyles).toHaveLength(11)
  expect(typeof css).toBe('function')
})
