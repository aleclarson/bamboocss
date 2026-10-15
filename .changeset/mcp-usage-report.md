---
'@bamboocss/mcp': minor
'@bamboocss/reporter': minor
'@bamboocss/node': minor
---

The MCP server's `get_usage_report` covers patterns, utilities and keyframes as well as tokens and recipes, and the
server keeps stdout to the protocol.

- `scope` takes `'pattern'`, `'utility'` and `'keyframe'`. Every pattern and keyframe the config defines is listed — at
  a count of nothing when nothing uses it — with how often each is called or named, and in how many files; the utilities
  are every style property written, a shorthand counted as the property it stands for. A keyframe counts as named
  through an `animations` token too, by name or through `token()`. `analyze()` returns `getPatternReport`,
  `getUtilityReport` and `getKeyframeReport` for the same.
- `bamboo analyze` and the token report count a value keyed by a condition — `{ base: 'red.300', md: 'blue.300' }`, or
  by a selector such as `'&:hover'` — as a value of the property above it, so the tokens it names are used. One keyed
  `base` was counted as a property named `base`, and one keyed by a condition was not counted as a token use at all. A
  `cva()` or `sva()` config is read for its styles, as a config recipe is — compound variants included, and
  `defaultVariants` no longer read as properties — and `sva()` is read at all; it was not.
- With a `logLevel` that logs, the first usage report printed `Analyzing N file(s)` onto stdout, which carries the
  protocol, and corrupted the stream. Everything the server logs goes to stderr, where a client shows it.
- A server whose client had gone kept running: a write into a pipe without a reader failed, and the failure was logged
  into the same pipe. It exits instead.
- The server reports the version installed rather than `1.0.0`.
