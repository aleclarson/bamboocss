import type { UtilityConfig } from '@bamboocss/types'

const positiveFractions = {
  '1/2': '50%',
  '1/3': '33.333333%',
  '2/3': '66.666667%',
  '1/4': '25%',
  '2/4': '50%',
  '3/4': '75%',
  full: '100%',
}
const negativeFractions = Object.fromEntries(
  Object.entries(positiveFractions).map(([key, value]) => [`-${key}`, `-${value}`]),
)
const fractions = { ...positiveFractions, ...negativeFractions }

/** `rotate: 'auto'`: a rotation about each axis, an unset one adding nothing. */
const ROTATE_AXES = 'var(--rotate-x, ) var(--rotate-y, ) var(--rotate-z, )'

export const transforms: UtilityConfig = {
  transformOrigin: {
    className: 'trf-o',
    group: 'Transform',
  },
  transformBox: {
    className: 'trf-b',
    group: 'Transform',
  },
  transformStyle: {
    className: 'trf-s',
    group: 'Transform',
  },
  transform: {
    className: 'trf',
    group: 'Transform',
  },
  rotate: {
    className: 'rotate',
    group: 'Transform',
    property: 'rotate',
    values: {
      auto: ROTATE_AXES,
      'auto-3d': ROTATE_AXES,
    },
    // `auto` composes the axes on `transform`. The `rotate` property holds one rotation about
    // one axis: fed two angles it computed to `none`, and fed one, a flat spin about z — so
    // `rotateX` never tilted anything. Anything else, `rotate: '45deg'`, is that one rotation.
    //
    // `auto` clears `rotate` as well, so one set under a condition replaces an angle beneath it
    // rather than adding to it: the two are different properties, and neither overrides the
    // other on its own.
    transform(value) {
      return value === ROTATE_AXES ? { rotate: 'none', transform: value } : { rotate: value }
    },
    // No `initialValue`: each is read with an empty fallback, so an axis left unset composes to
    // nothing, as `filter`'s functions do.
    customProperties: {
      '--rotate-x': { inherits: false, syntax: '*' },
      '--rotate-y': { inherits: false, syntax: '*' },
      '--rotate-z': { inherits: false, syntax: '*' },
    },
  },
  // An angle each, so not typed as `rotate` values: `none` or `x 45deg` would come out as
  // `rotateX(none)`, which takes the whole composed `transform` down with it.
  rotateX: {
    className: 'rotate-x',
    group: 'Transform',
    transform(value) {
      return {
        '--rotate-x': `rotateX(${value})`,
      }
    },
  },
  rotateY: {
    className: 'rotate-y',
    group: 'Transform',
    transform(value) {
      return {
        '--rotate-y': `rotateY(${value})`,
      }
    },
  },
  rotateZ: {
    className: 'rotate-z',
    group: 'Transform',
    transform(value) {
      return {
        '--rotate-z': `rotateZ(${value})`,
      }
    },
  },
  scale: {
    className: 'scale',
    group: 'Transform',
    property: 'scale',
    values: {
      auto: 'var(--scale-x) var(--scale-y)',
    },
    // `1`, not `0`: an unset axis has to compose to the identity scale.
    customProperties: {
      '--scale-x': { inherits: false, initialValue: '1', syntax: '*' },
      '--scale-y': { inherits: false, initialValue: '1', syntax: '*' },
    },
  },
  scaleX: {
    className: 'scale-x',
    group: 'Transform',
    transform(value) {
      return {
        '--scale-x': value,
      }
    },
  },
  scaleY: {
    className: 'scale-y',
    group: 'Transform',
    transform(value) {
      return {
        '--scale-y': value,
      }
    },
  },
  translate: {
    className: 'translate',
    group: 'Transform',
    property: 'translate',
    values: {
      auto: 'var(--translate-x) var(--translate-y)',
      'auto-3d': 'var(--translate-x) var(--translate-y) var(--translate-z)',
    },
    customProperties: {
      '--translate-x': { inherits: false, initialValue: '0', syntax: '*' },
      '--translate-y': { inherits: false, initialValue: '0', syntax: '*' },
      '--translate-z': { inherits: false, initialValue: '0', syntax: '*' },
    },
  },
  translateX: {
    shorthand: 'x',
    className: 'translate-x',
    group: 'Transform',
    values(theme) {
      return {
        ...theme('spacing'),
        ...fractions,
      }
    },
    transform(value) {
      return {
        '--translate-x': value,
      }
    },
  },
  translateY: {
    shorthand: 'y',
    className: 'translate-y',
    group: 'Transform',
    values(theme) {
      return {
        ...theme('spacing'),
        ...fractions,
      }
    },
    transform(value) {
      return {
        '--translate-y': value,
      }
    },
  },
  // No fractions: they are percentages, and `translate` has no size in z to take one of, so
  // `translateZ: '1/2'` invalidated the whole declaration and dropped x and y with it.
  translateZ: {
    shorthand: 'z',
    className: 'translate-z',
    group: 'Transform',
    values(theme) {
      return theme('spacing')
    },
    transform(value) {
      return {
        '--translate-z': value,
      }
    },
  },
}
