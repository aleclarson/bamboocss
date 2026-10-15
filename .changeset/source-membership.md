---
'@bamboocss/node': patch
'@bamboocss/eslint-plugin': patch
---

Whether a file is a source is answered as the source glob reads `include` and `exclude`.

- A negated pattern in `include` — `['src/**/*.tsx', '!src/legacy/**']` — made every path a source wherever that was
  asked without the glob. The Vite compiler took each module it was handed for one, `node_modules` included, a file
  added anywhere in a dev session set off a scan of every source, and `bamboo --watch` rebuilt on any change. It now
  passes over what it names and nothing else, as the glob does; so does a negated pattern in `exclude`, which the glob
  reads without its `!`.
- A folder named in `exclude` — `src/legacy`, `**/legacy` — is passed over whole below where the glob begins, as the
  glob passes over it; one named with a glob of its own, `src/legacy/*`, still passes over only what it matches. Its
  files were still taken for sources, so the compiler built classes from them that the stylesheet was never built from.
- What `exclude` names is passed over inside a hidden folder `include` reaches, and each pattern is matched as its own
  walk spells a path — from `cwd`, or from the root for one written as an absolute path — so `**/*.tsx` no longer makes
  a file outside the project a source. A `.d.ts` added under a `dependencies` glob no longer reloads the config, since
  the glob that expands `dependencies` never reads it.
- The ESLint plugin reads `include` the same way. `bamboo/file-not-included` now reports a file in a hidden folder —
  `.storybook/preview.tsx` — which the build's glob never enters, and the rules that check only what the build reads
  (`no-unresolved-styles`, `require-recipe-class-name`, `no-unlayered-override`, `no-config-function-in-source`) pass
  over it, as the build does.
- Asked of a module, the answer costs much what it did, measured side by side: 0.41–0.46 µs for a source against
  0.37–0.41 µs, the same for a dependency, and 0.87–0.98 µs against 0.60–0.87 µs where `exclude` names a folder, which
  is now looked for.
