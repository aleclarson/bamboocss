---
'@bamboocss/vite': patch
---

Name a server environment's copy of the stylesheet after the sheet an environment writing its assets wrote, so a server
bundle linking it through `virtual:bamboo.css?url` links a file that exists. Vite discards the server's copy, and it was
named after its own pruned bytes: built before the client, the server pruned against itself alone, and every
server-rendered page linked a stylesheet no environment wrote.

- The copy takes the name and bytes of the sheet last written under the same original name, a browser environment's
  first. A sheet counts once its output is written: one another plugin rejected names nothing.
- When the server's output is written first, its links to the copy move to the sheet the client writes after it, and in
  a watch they move again each time that sheet is written under a new name. A link the process never could move is named
  in a warning as it exits; a copy imported only for its effect, which nothing links, is not.
- The copy is no longer split per chunk or held for the run to finish, and nothing written changes otherwise.
