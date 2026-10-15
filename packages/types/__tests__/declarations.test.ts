import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import ts from 'typescript'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { main as build } from '../scripts/build'

/**
 * The declarations as the package ships them, read the way a project with `skipLibCheck` off
 * reads them.
 *
 * Each is its source copied, and a declaration file exports every declaration in it, so the
 * helpers `pattern.ts` and `composition.ts` keep copies of — they are copied whole into every
 * project's `styled-system/types` — were each exported twice through the index's `export type *`:
 * `LiteralUnion`, `Primitive`, `Recursive`, `Token`. Four TS2308 in every such project.
 */
const out = mkdtempSync(join(tmpdir(), 'bamboo-types-'))
let program: ts.Program
let index: ts.Symbol

beforeAll(() => {
  build(out)
  // The package's own dependencies, which the declarations import.
  symlinkSync(
    join(import.meta.dirname, '..', 'node_modules'),
    join(out, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  program = ts.createProgram([join(out, 'index.d.ts')], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  })
  index = program.getTypeChecker().getSymbolAtLocation(program.getSourceFile(join(out, 'index.d.ts'))!)!
}, 60_000)
afterAll(() => rmSync(out, { force: true, recursive: true }))

test('type-check with skipLibCheck off', () => {
  const diagnostics = ts.getPreEmitDiagnostics(program)

  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
})

// Each from the module the package's source exports it from — not whichever copy `export type *`
// met first, which made `Token` `composition.ts`'s two-field one in a project not checking it.
test('name each of the shared helpers from its own module', () => {
  const checker = program.getTypeChecker()
  const exports = new Map(checker.getExportsOfModule(index).map((symbol) => [symbol.name, symbol]))
  const moduleOf = (name: string) => {
    const symbol = exports.get(name)!
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return basename(target.declarations![0]!.getSourceFile().fileName)
  }

  expect(
    Object.fromEntries(['LiteralUnion', 'Primitive', 'Recursive', 'Token'].map((name) => [name, moduleOf(name)])),
  ).toEqual({
    LiteralUnion: 'shared.d.ts',
    Primitive: 'shared.d.ts',
    Recursive: 'shared.d.ts',
    Token: 'tokens.d.ts',
  })
})

// Every name a project imports from `@bamboocss/types`, so that resolving an ambiguity can never
// quietly drop one: a declaration file exports what its source does not, and projects import it.
test('export every name they did', () => {
  const checker = program.getTypeChecker()

  expect(
    checker
      .getExportsOfModule(index)
      .map((symbol) => symbol.name)
      .sort(),
  ).toMatchSnapshot()
})
