---
'@bamboocss/core': patch
'@bamboocss/generator': patch
---

A theme's tokens under a selector condition such as `_dark` hold wherever the theme and the condition meet, not only
where the `data-bamboo-theme` attribute and the dark class share an element.

- `.dark &` was compounded onto the theme's root, `[data-bamboo-theme=pastel].dark`. A theme in a page that
  `<html class="dark">` puts in dark mode kept its light values, and a dark panel inside the theme took the default dark
  values instead of the theme's. The condition now meets the root above it, on it and inside it, in the stylesheet and
  in the theme files `styled-system/themes` loads on demand.
- On the root of a theme nested inside, the outer theme's rule is no more specific than that root: the nested theme's
  own dark values win there, and the outer theme's fill in what it leaves out. Two cases still resolve by the order the
  themes are written in: a value the nested theme sets for every mode, on its root when that carries the dark class, and
  a dark class on an element inside two nested themes.
- A condition with a combinator of its own, `.dark > &`, meets the theme from above only, and one with its `&` in the
  middle, `.dark & .panel`, is written around the root as it stands.
- A theme loaded on demand holds its own variables alone: `theme-pastel.json` carried those of a theme named
  `pastelDark` as well.
- A condition of the project's own whose name begins with `theme`, such as `themeDim`, had its tokens dropped from the
  stylesheet with those of every theme `staticCss.themes` leaves out. They are written as any condition's are.
