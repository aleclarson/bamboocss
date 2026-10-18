---
'@bamboocss/vite': patch
---

In a watch, hold a stylesheet written while another environment is replacing its output, and prune it again from source
once that output is written, so a rebuild of several environments writes what a full build of the same sources would. An
edit to a module only the server imports rebuilds the client too, and the client's sheet was pruned against the server's
previous output and written as final: a class new to the extraction shipped with no rule, usually with no error, and one
extracted before and pruned failed the server's rebuild though the client's could keep it.

- When the replacement fails, the sheet is pruned again against the output that is still live, to the same bytes.
- The guard in those rounds stands aside only for a sheet that will yet be pruned with the rebuilding environment's
  output in view: one held so, or one a replacing environment has not pruned yet. A sheet pruned before the sibling
  began replacing, and so not held, still fails a rebuild newly using a class it lost.
- An output one of Bamboo's own output hooks fails, which no hook reports, no longer leaves its environment replacing
  for good.
- A full build is unchanged.
