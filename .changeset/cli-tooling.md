---
'@bamboocss/dev': minor
'@bamboocss/node': minor
'@bamboocss/shared': patch
---

`bamboo analyze --unused`, `bamboo doctor` and `bamboo debug --zip`.

- `bamboo analyze --unused` lists the configured names no source uses — tokens, recipes, patterns and keyframes — one to
  a line on stdout, or bare under `--scope`, which now takes `pattern` and `keyframe` too. A token or a keyframe is
  listed when the build's own prune removes it, with every prune on whatever the config says: a name listed is one the
  stylesheet already ships without, and one the prune keeps for a reader it cannot follow — a `token()` path built at
  runtime, a theme, a `keepTokens` pattern — is not. A recipe or a pattern is listed when no source calls it and
  `staticCss` does not emit it regardless.
- `bamboo doctor` checks a project as the build reads it, without writing anything: its config, the sources `include`
  selects, and the generated `styled-system` against what `bamboo codegen` would write now. It exits 1, saying what to
  fix, for a generated file missing, out of date or no longer generated, a source that cannot be extracted, or a call to
  a pattern or recipe that does not exist. `--json` prints the report as JSON.
- `bamboo debug --zip` writes the debug files as one `<outdir>.zip`, to attach to a bug report.
- `--silent` quiets every command for a project whose config names a `logLevel`, which creating the context set again
  over it. Under `bamboo analyze` it quiets the reporter too, which logs through the logger's ES module: another
  instance than the CommonJS one the CLI holds.
- Where stdout is the output — `analyze --unused`, `doctor --json` — the log goes to stderr, and a reader that stops
  reading, `| head -1`, ends the command rather than failing it.
