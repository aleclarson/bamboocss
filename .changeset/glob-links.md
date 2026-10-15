---
'@bamboocss/node': patch
---

The source glob ends where a symbolic link leads back into a folder it is reading.

- `include` follows links, as it did — a workspace package, a folder linked into `src` — and a link to a folder the walk
  was inside took it round that folder again, lap after lap until the system would resolve no deeper a chain of links,
  some thirty: each file in it was returned, and extracted, once per lap. Two such links on the way doubled the laps
  each time round, and the build hung at the glob with nothing to say why. A folder such a link leads into is now read
  as empty, as `find -L` reads it, since it is being read already by the path that reached it first.
- A link that closes no loop is followed, and every path through it returned, as before. One to a folder above where the
  walk began is followed too, for what else is in that folder, and so goes round once before the loop closes at its next
  showing. A pattern that only a path round a loop could meet — `src/*/loop/**` through `src/a/loop` linked to `src` —
  now matches nothing, where it met a lap's worth of copies of files the walk reaches anyway.
- Each pattern is walked from the folder it starts at, so where a loop closes, and so what a pattern matches, does not
  depend on the others in `include`.
- Over 5,000 files the glob takes 7.1 ms, as `fast-glob` alone does in the same runs (7.0 ms), and 14.3–14.5 ms with a
  hundred folders linked in a second time, against 14.3–14.5 ms: a link is told by the stat the walk makes of it anyway,
  and only the folders above it are stat'd.
