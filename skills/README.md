# Bamboo CSS agent skills

Official [Agent Skills](https://skills.sh) for Bamboo CSS. They teach coding agents to write Bamboo correctly: which API
to reach for, which token names exist, and what the build-time compiler accepts and refuses.

## Install

```sh
npx skills add gajus/bamboocss
```

The command reads the skills in this directory. Each loads on its own triggers, so you never have to name one. The
documentation page is [Agent Skills](https://bamboocss.com/docs/ai/agent-skills).

## Skills

### `bamboo-css`

Day-to-day styling in a project that already has Bamboo set up: `css()`, `cx()`, patterns, `cva`/`sva` and config
recipes, tokens and conditions, and the compile contract that decides whether a call builds.

Triggers on: building or changing components, a build failing with `call(s) could not be compiled`, a runtime
`was not compiled` error, styles that do not apply, picking between `css()`, a pattern and a recipe.

### `bamboo-css-theming`

Theme and component-style architecture, where the decisions are hard to reverse.

Triggers on: setting up tokens and semantic tokens, adding brand colors, wiring dark mode, shipping more than one theme
with `theme.variants`, choosing presets (including the opt-in `typographyPreset()`), defining mixins, designing a
variant API, deciding between `cva`, a config recipe and a slot recipe, cleaning up a theme that has drifted.

### `bamboo-css-migrate`

Moving a project from Panda CSS to Bamboo, and debugging one that built on Panda and fails on Bamboo. It follows
[Migrating from Panda CSS](https://bamboocss.com/docs/migration/panda) rather than restating it.

Triggers on: replacing `@pandacss/*` packages, renaming `panda.config.ts`, config options that were removed or renamed,
`styled-system/jsx`, `styled()`, `<Stack>`, template literal styles and `{token}` references that stop working, calls
Panda accepted that the compiler refuses, CSS output changing after the switch.

## What these are not

They do not replace the docs. Bamboo publishes them for language models at
[bamboocss.com/llms.txt](https://bamboocss.com/llms.txt), split by category, and the skills send agents there for API
detail rather than restating it.

They do not replace the linter. `@bamboocss/eslint-plugin` mechanically reports token paths that do not exist, nested
selectors without `&`, files outside `include` and dynamic styling. A rule that runs beats a rule an agent might read.

They do not replace `@bamboocss/mcp`, which answers from a running project's config: its tokens, recipes, patterns and
usage.

## Structure

```txt
skills/
├── README.md
├── bamboo-css/
│   └── SKILL.md
├── bamboo-css-theming/
│   └── SKILL.md
└── bamboo-css-migrate/
    └── SKILL.md
```

## Contributing

- **Skills change with the API.** A change to something a skill names (a config option, a CLI command, a compiler
  diagnostic, a generated path) updates that skill in the same commit.
- **Verify every claim against this repository.** Bamboo diverged from Panda, so Panda's docs and skills are not a
  source: what Panda allows, the compiler may refuse.
- **Keep bodies short.** A skill is a decision engine, not documentation: under 200 lines where possible and never over
  300, with depth left to the docs it links.
- **Frontmatter.** `name` matches the directory, in lowercase with hyphens, at most 64 characters. `description` is at
  most 1024 characters and says when to use the skill and when to use a sibling instead.
- **Examples build against a default config.** Use the default presets' tokens (`gray.900`, `blue.500`, `4`), or define
  the ones an example uses in the same skill, so an agent can copy it into any project.
- Format with `pnpm exec oxfmt skills`.
