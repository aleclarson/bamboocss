---
'@bamboocss/node': patch
'@bamboocss/reporter': patch
'@bamboocss/mcp': patch
---

`bamboo analyze` and the MCP server's `get_usage_report` agree with `analyze --unused`. Counted from source alone, a
token read only through a semantic token, another token's value, a mixin or `global.css` was reported unused, and one
written only in a config recipe nothing calls was reported used. Keyframes reached through a semantic animation token or
a mixin showed `usedCount: 0`, so an agent reading the report could delete keyframes the build still needed.

- The token table counts a token as used exactly when the build keeps it, and lists a category nothing names directly.
- Each pattern and keyframe entry says whether it is `unused`, and the MCP report lists the build's verdict under
  `unused`, for the kinds asked.
- `--outfile` writes the same verdict beside the report.
