---
'@bamboocss/node': patch
---

On Windows, extract a file that reaches bamboo only through a local module. The pass that decides which files can hold a
call resolved each local import with `path.resolve`, which spells a path with `\` there, and held it up against the
project root and the inventory, both spelled with `/`: no local import matched, so a recipe defined in one file and
called in another, or `css` re-exported through a barrel or a path alias, was never extracted. A build then failed on a
compiled class with no rule, and in dev the elements went unstyled until the file was edited. Local modules outside
`include` that need transformed bytes were read raw from disk for the same reason.
