---
'@bamboocss/vite': patch
---

Name a server environment's copy of the stylesheet after the sheet an environment writing its assets wrote, so a server
bundle linking it through `virtual:bamboo.css?url` links a file that exists. Vite discards the server's copy, and it was
named after its own pruned bytes: built before the client, the server pruned against itself alone, and every
server-rendered page linked a stylesheet no environment wrote. The copy now takes the written sheet's name and bytes,
or, when the server builds first, its written output is moved to that name once the client writes the sheet, with a
warning as the process exits if no environment ever does. The copy is no longer split per chunk or held for the run to
finish, and nothing written changes otherwise.
