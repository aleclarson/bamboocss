---
'@bamboocss/node': patch
'@bamboocss/config': patch
'@bamboocss/dev': patch
---

A config edited while a build watches it — `bamboo --watch`, or a dev server — is read again as it was read first, and
the rebuild after it writes what it has to.

- The reload read the file alone, so the context it built had none of what the integration had added to it. The Vue,
  Svelte and Astro parsers went, and every `.vue`, `.svelte` and `.astro` file's styles left the stylesheet at the first
  edit to the config. So did the mark of a dev server's build, which `hash: 'auto'` reads, so every class name the
  browser held changed. So did a `cwd` the integration was handed and a `config` it laid over the file's — the flags
  `bamboo --watch` was run with among them: at the first edit, `--outdir`, `--hash`, `--minify` and the globs it was
  handed went back to what the file says.
- A config is now read again the way it was prepared, every time it is read again: from where it was read first,
  wherever the process has moved since, and with what was laid over it then. Under a dev server, a plugin's
  `config:change` is handed the config as it reads after the edit, not the one the edit replaced.
- `clean` empties the output directory before a run that writes every artifact, and no longer before a rebuild that
  writes only what an edit changed: with `clean` set, the first edit under a watch took most of `styled-system/` with
  it.
- An edit to what every artifact is written from — `outExtension`, `outdir`, `emitTokensOnly`, `plugins` — rebuilds
  every artifact, as a run from cold does: the output directory is emptied first under `clean`, and `codegen:prepare`
  and `codegen:done` are told every artifact changed. The ones no option names, `helpers`, `cva` and `css/index` among
  them, were left under the old extension or in the old directory, where the rest no longer found them. Without `clean`,
  what the old extension or directory still holds stays where it is.
- `bamboo ship --watch --minify` keeps minifying after an edit to the config, and `bamboo codegen` without `--clean` no
  longer sets aside a `clean: true` in the config.
