import type { PropertyTransform } from '@bamboocss/types'

/**
 * A colour, with an opacity modifier — `red.300/50` — mixed through a variable of its own.
 * `name` names that variable when `prop` is not one to build a name from: a custom property's
 * would come out as `--mix---scrollbar-thumb`.
 */
export const createColorMixTransform =
  (prop: string, name = prop): PropertyTransform =>
  (value, args) => {
    const mix = args.utils.colorMix(value)
    if (mix.invalid) return { [prop]: value }

    const cssVar = '--mix-' + name

    return {
      [cssVar]: mix.value,
      [prop]: `var(${cssVar}, ${mix.color})`,
    }
  }
