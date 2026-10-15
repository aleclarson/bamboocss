---
'@bamboocss/preset-base': minor
---

Fix the transform and scrollbar utilities whose CSS the browser threw away, and add `scrollbarThumb` and
`scrollbarTrack`.

- **`rotateX`, `rotateY`, `rotateZ`** fed the `rotate` property, which holds one rotation about one axis: one axis
  became a flat spin about z, and two computed to `none`. `rotate: 'auto'` now composes them on `transform` —
  `css({ rotate: 'auto', rotateX: '45deg', rotateY: '30deg' })` applies both — and clears `rotate`, so under a condition
  it replaces an angle beneath it. A single value, `rotate: '45deg'`, still uses `rotate`. A `transform` of your own on
  the same element competes with the composition; write the functions together there. The axes are no longer typed as
  `rotate` values, whose `none` came out as `rotateX(none)`.
- **`translateZ`** no longer offers fractions. A percentage in z invalidated the whole `translate`, and dropped x and y
  with it; use a `spacing` token or a length.
- **`scrollbarWidth`** takes `auto`, `thin` or `none` rather than `sizes` tokens, which `scrollbar-width` never took.
- **`scrollbarColor`** is the two colours written out, `'red transparent'` — under `strictValues`,
  `'[red transparent]'`. A single colour token was never a value of `scrollbar-color`, and is no longer resolved as one;
  use `scrollbarThumb` for it.
- **`scrollbarThumb` and `scrollbarTrack`** each colour one side of `scrollbar-color` with a `colors` token, and
  compose: set either, or both. A side left unset is the text colour for the thumb and transparent for the track, not an
  ancestor's.
