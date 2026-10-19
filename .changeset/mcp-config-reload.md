---
'@bamboocss/mcp': patch
---

The MCP server picks up config changes without a restart. It loaded the config once, when the client started it, so a
token or a recipe added during an agent's session never reached `get_tokens` or `get_recipes`. Each call now checks the
config and the files it imports, a preset swapped in by the last edit among them, and reloads when any has changed.

- A config that fails to load fails the call with its error, rather than the previous config answering.
- `get_recipes` and `get_patterns` take any name and say which ones exist when it is not one of them. Their filters were
  enums of the names the server started with, which rejected a recipe added since.
