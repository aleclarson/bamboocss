---
'@bamboocss/vite': patch
'@bamboocss/generator': patch
---

A responsive or conditional recipe selection, `button({ size: { base: 'sm', md: 'lg' } })`, fails the build, saying to
write the condition inside the variant's styles. It compiled into the selection lookup, where the object matched no
variant, so the element rendered without one and nothing reported it.

- A config recipe's variant props no longer take a conditional value, which the generated types allowed for a recipe
  without compound variants.
