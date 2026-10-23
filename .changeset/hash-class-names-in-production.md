---
'@bamboocss/core': minor
'@bamboocss/config': minor
---

Class names are hashed in production by default. `hash` now defaults to `{ className: 'auto', cssVar: false }`: the Vite
dev server keeps the readable names it always had, and production builds and CLI output write the short hashed ones. CSS
variables stay readable, since hand-written CSS refers to them by name.

1.42.0 kept readable names as the default because the gzipped stylesheet is about 4% smaller with them. A server render
pays more than that. A class holding any of `& " ' < >` — a selector condition, a quoted value — sends the whole
attribute through React's escaper, and every readable name is long. The css-in-js benchmark's Bamboo lane, built before
and after with no `hash` set, as % of plain React (run to run, about ±5%):

|                | render, readable | render, hashed | render + encode, readable | render + encode, hashed |
| -------------- | ---------------- | -------------- | ------------------------- | ----------------------- |
| product-grid   | 65%              | 103%           | 63%                       | 93%                     |
| tabs           | 39%              | 84%            | 39%                       | 83%                     |
| multifile-shop | 64%              | 100%           | 62%                       | 92%                     |

Product-grid's markup for 400 tiles goes from 1.09 MB to 0.50 MB. The compiler's own cost does not move: `vite/fold`
with class names hashed reads −5% to +4% against readable, as its controls do.

What still reads readable class names from production output has to change or opt out:

- **Markup written by hand.** An HTML page, or a class `staticCss` emits for a name assembled at runtime, cannot name a
  hashed class. Set `hash: false` to keep class names readable in production. A build that hashes the classes
  `staticCss` emits now warns about it.
- **Tests and selectors against a production build.** E2E selectors, snapshots of production markup and stylesheet
  overrides that name atoms see hashed names. Select by role or a `data-*` attribute instead.

`hash: 'auto'` also merges like `hash: true` now. It was left a scalar, so an app's `'auto'` lost to a preset that set
either `className` or `cssVar`.
