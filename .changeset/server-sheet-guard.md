---
'@bamboocss/vite': patch
---

Fail a server environment that emits a stylesheet of its own when it newly uses a class the browser's stylesheet pruned,
as one emitting none fails. Its own sheet keeps the rule, but its pages link the browser environment's, so an in-memory
run, a run that builds environments one at a time without announcing them, or a watch rebuild of that environment passed
with the page unstyled until the browser's environment built again. A browser environment is still not refused for what
its own last sheet pruned, and neither is a server environment linking its own copy through `virtual:bamboo.css?url`.
The guard reads each environment's `consumer`, so a second environment serving a sheet of its own to the browser sets
`consumer: 'client'`.
