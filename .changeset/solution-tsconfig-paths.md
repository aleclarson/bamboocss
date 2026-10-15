---
'@bamboocss/config': patch
'@bamboocss/node': patch
---

Resolve tsconfig `paths` from referenced projects, for a solution-style `tsconfig.json` — `"files": []` and
`references`, as `create vite` lays a project out. The root declares no `paths`; they are in `tsconfig.app.json`.

- A config importing through an alias bundles. Each file esbuild reads under the root resolves its imports through the
  aliases of the project including it — references of references included. The config beside the root, in none, resolves
  through the `paths` of whichever project's patterns match and reach a file, or through the root's own aliases when it
  declares any. Only aliases: no other option of those projects applies, nor a `baseUrl` alone, which would put a
  directory ahead of every package. A package the config imports keeps resolving through its own tsconfig, and any other
  root is left to esbuild, as before.
- A source importing through one resolves, so the value it imports reaches the stylesheet and the compiler. Sources
  resolve through the first project including files where `include` points and declaring aliases, rather than through
  the config file's project, which declares none when it sits beside the root or in `tsconfig.node.json`. With no such
  project they resolve as before, and a root that compiles the sources itself is left as it was.
- `baseUrl`, and `paths` written without one, resolve against the directory of the tsconfig declaring them, as
  TypeScript resolves them, rather than against the project root.
- A referenced tsconfig that does not parse — an `extends` naming a package that is not installed — is passed over
  rather than failing the build. One that does not exist yet is a dependency of the config, and `--watch` now reloads
  the config when a file it depends on appears, not only when one changes.
