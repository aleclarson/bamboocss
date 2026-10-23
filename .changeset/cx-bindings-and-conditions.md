---
'@bamboocss/vite': minor
---

`cx()` compiles when its arguments name style bindings and choose between them. `cx(badge, discount >= 30 && badgeHigh)`
— a module-scope `const` holding a `css()` or pattern call, declared beside the call or imported from another module,
picked with `test && value` or `test ? a : b` — was left to the runtime `cx`, which joined the same strings again on
every render. Each combination of answers is now composed at build time, and the call compiles to a ternary choosing
between them:

```tsx
const badge = css({ background: 'amber.500', color: 'white' })
const badgeHigh = css({ background: 'red.600' })

cx(badge, discount >= 30 && badgeHigh)
// (discount >= 30) ? "bg_red.600 c_white" : "bg_amber.500 c_white"
```

They compose as a `cx()` of the `css()` calls themselves always has: declarations merge and later arguments win, so an
overridden declaration — the amber background above — no longer reaches the markup beside the one that beat it. Where
the two used to disagree, the stylesheet's order decided which one applied; the argument order decides now, as the
`cx()` documentation says.

Every condition still runs exactly when, and as often as, it did in the call. Up to three independent conditions — eight
combinations — are compiled; a call with more, a condition reading a Bamboo import or a recipe, and a binding that is
not a `const` holding a static call stay the runtime join they were written as.
