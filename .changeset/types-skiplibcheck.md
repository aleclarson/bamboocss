---
'@bamboocss/types': patch
---

`@bamboocss/types` type-checks with `skipLibCheck: false`. `pattern.ts` and `composition.ts` keep their own copies of
`LiteralUnion`, `Primitive`, `Recursive` and `Token` — they are copied whole into every project's `styled-system/types`
— and a declaration file exports every declaration in it, so the index's `export type *` found each of those names
twice: four TS2308 in every project type-checking its dependencies. The index now names each from the module it belongs
to, and every name the package exported before, it still exports.

`Token` is the token type the package's source exports — with `type`, `deprecated` and `extensions` beside `value` and
`description`. In a project not checking its dependencies it had been `composition.ts`'s private two-field one, which
the index's `export type *` met first.
