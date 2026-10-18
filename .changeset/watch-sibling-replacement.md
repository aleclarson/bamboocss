---
'@bamboocss/vite': patch
---

In a watch, hold a stylesheet written while another environment is replacing its output, and prune it again from source
once that output is written, so a rebuild of several environments writes what a full build of the same sources would. An
edit to a module only the server imports rebuilds the client too, and the client's sheet was pruned against the server's
previous output and written as final: a class new to the extraction shipped with no rule, usually with no error, and one
extracted before and pruned failed the server's rebuild though the client's could keep it. When the replacement fails,
the sheet is pruned again against the output that is still live, to the same bytes. The guard in those rounds stands
aside only for a sheet held so, or one whose environment is replacing it, and a full build is unchanged.
