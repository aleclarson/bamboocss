import { createGeneratorContext } from '@bamboocss/fixture'
import type { GlobalVarsDefinition } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'

function globalVars(vars?: GlobalVarsDefinition) {
  const ctx = createGeneratorContext({
    global: { vars },
  })
  const sheet = ctx.createSheet()
  sheet.processGlobalCss({})
  return sheet.toCss()
}

describe('Global vars', () => {
  test('it works', () => {
    const css = globalVars({
      '--random-color': 'red',
      '--button-color': {
        syntax: '<color>',
        inherits: false,
        initialValue: 'blue',
      },
    })

    expect(css).toMatchInlineSnapshot(`
      "@layer base {
        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }

        :where(html) {
          --random-color: red;
      }

        @property --button-color {
          syntax: '<color>';

          inherits: false;

          initial-value: blue;
        }
      }"
    `)
  })
})
