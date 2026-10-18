---
'@bamboocss/vite': patch
---

Read which classes a stylesheet pruned off the outputs on disk whenever the check for them runs, so a rebuild is no
longer refused for a class the sheet holds. When the environment completing a run finalized the sheet in its output and
another plugin then rejected that output, the record the check read still held the sheet's provisional losses — only
that output being written rebuilt it — and the environment's next rebuild failed naming a class the finalized sheet on
disk holds. The rebuild after that passed.
