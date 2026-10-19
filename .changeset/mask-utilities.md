---
'@bamboocss/preset-base': minor
'@bamboocss/types': patch
---

Add the mask utilities Panda 2 added: fade an edge with `maskBottomFrom: '40%'`, both sides with `maskXFrom`, or stack
linear, radial and conic layers with `maskLinearFrom`, `maskRadialFrom` and `maskConicFrom`, each with `To`, `FromColor`
and `ToColor`. The helpers compose one layered `mask-image` through variables registered with `@property`, which the
stylesheet keeps only where a rule reads them. See the new Masks page.

- A conic stop takes an angle or a percentage of the turn, `maskConicFrom: '45deg'`. Panda types it as a length, which a
  conic stop never takes, so an angle fell back to the initial value and a length emptied the mask.
- This changes the css of the mask properties that had no utility of their own: `maskPosition`, `maskRepeat`, `maskClip`
  and `maskOrigin` are written `-webkit-` first, as `mask`, `maskImage` and `maskSize` were, and each of them, with
  `maskMode` and `maskType`, takes a short class name, `msk-p_center` for `mask-position_center`. `maskComposite` is
  written through the variables the helpers read, so whichever class comes last it holds.
