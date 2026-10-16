import type { Tokens } from '@bamboocss/types'

export const colors: Tokens['colors'] = {
  background: {
    neutral: {
      subtle: {
        DEFAULT: { value: '#00000000' },
      },
    },
    warning: {
      bold: {
        DEFAULT: { value: '#FBC828' },
        hovered: { value: '#FCA700' },
        pressed: { value: '#F68909' },
      },
    },
  },
  chart: {
    categorical: {
      '5': {
        DEFAULT: { value: '#1558BC' },
      },
      '6': {
        DEFAULT: { value: '#964AC0' },
      },
      '7': {
        DEFAULT: { value: '#42B2D7' },
      },
    },
    danger: {
      DEFAULT: { value: '#E2483D' },
    },
    warning: {
      DEFAULT: { value: '#F68909' },
    },
    success: {
      DEFAULT: { value: '#82B536' },
    },
    discovery: {
      DEFAULT: { value: '#BF63F3' },
    },
  },
  rovo: {
    border: {
      saffron: { value: '#FCA700' },
    },
    icon: {
      saffron: { value: '#FCA700' },
    },
  },
}
