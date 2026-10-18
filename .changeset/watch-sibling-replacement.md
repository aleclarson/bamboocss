---
'@bamboocss/vite': patch
---

In a watch, prune a stylesheet written while another environment is replacing its output again from source once that
output is written, so a rebuild of several environments writes what a full build of the same sources would. An edit to a
module only the server imports rebuilds the client too, and the client's sheet was pruned against the server's previous
output and written as final: a class new to the extraction shipped with no rule, usually with no error, and one
extracted before and pruned failed the server's rebuild though the client's could keep it.

- A sheet is pruned again as each environment it waits for settles — its output written, or its replacement failed — so
  an output another plugin rejects, which no hook reports, holds nothing back.
- Where the guard stands aside for a sheet about to be pruned again, it has that sheet pruned again with its own
  environment's output once that is written, whatever becomes of the sibling's. A sheet whose output pass pruned it with
  no sibling replacing is final, and the guard reads what it lost, in place of what the sheet before it lost.
- A full build, and the first build of a watch, are unchanged.
