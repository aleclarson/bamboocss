import { describe, expect, test } from 'vitest'
import { parseSelectors, stringify } from '../src/stringify'

describe('stringify', () => {
  test('should convert', () => {
    expect(stringify({ whiteSpace: 'nowrap' })).toMatchInlineSnapshot(`
      "white-space: nowrap;
      "
    `)

    expect(stringify({ '--welcome-x': '20' })).toMatchInlineSnapshot(`
      "--welcome-x: 20;
      "
    `)
  })

  test('convert @scope in nesting', () => {
    expect(
      stringify({
        '.parent': {
          color: 'blue',
          '@scope (& > .scope) to (& .limit)': { '& .content': { color: 'red' } },
        },
      }),
    ).toMatchInlineSnapshot(`
      ".parent {color: blue;
      }@scope (.parent > .scope) to (.parent .limit) {.parent .content {color: red;
      }
      }
      "
    `)
  })

  /**
   * A parent carrying a combinator, nested under a selector that mentions `&` twice, is the one
   * shape that reaches the `:is(...)` branch in `getResolvedSelectors`. The two regexes deciding
   * it were global, and `.test()` advances `lastIndex` on a match — so the branch was taken on
   * the first call and skipped on the next, from the same input. Repeating the call is the whole
   * point of this test: one call passes either way.
   */
  test('a combinator parent resolves the same on every call', () => {
    const styles = () => ({ '.a .b': { '&:hover &': { color: 'red' } } })

    const outputs = Array.from({ length: 4 }, () => stringify(styles()))

    expect(new Set(outputs).size).toBe(1)
    // `:is()` rather than a bare parent: `.a .b:hover .a .b` selects a different element set.
    expect(outputs[0]).toMatchInlineSnapshot(`
      ":is(.a .b):hover :is(.a .b) {color: red;
      }
      "
    `)
  })

  // A comma in a quoted attribute value is the value's: it split the selector there.
  test('a selector list is split at commas outside quotes', () => {
    expect(parseSelectors(`&[data-a="x, y"], &[data-b='z,w'], .c`)).toEqual([
      `&[data-a="x, y"]`,
      `&[data-b='z,w']`,
      '.c',
    ])
  })

  // And an `&` in one is the value's character, not the parent.
  test('a parent is written only where `&` names it', () => {
    expect(stringify({ '.p': { '&[data-a="b & c"]': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".p[data-a="b & c"] {color: red;
      }
      "
    `)
    // With nothing above it, the `& ` it names is dropped, and the one in the value kept.
    expect(stringify({ '.q[data-a="& "] & .r': { color: 'red' } })).toMatchInlineSnapshot(`
      ".q[data-a="& "] .r {color: red;
      }
      "
    `)
  })

  // Read the same whether or not the selector quotes anything: an escaped `\&` is a literal one,
  // and the parent is written as it is, `$` and all, where `String.replace` expanded `$&`.
  test('a parent is written the same way whatever else the selector holds', () => {
    expect(stringify({ '.p': { '.x\\& &': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".x\\& .p {color: red;
      }
      "
    `)
    expect(stringify({ '.p': { '.x\\&[a="1"] &': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".x\\&[a="1"] .p {color: red;
      }
      "
    `)
    expect(stringify({ '.p$&': { '&[a="1"], &:hover': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".p$&[a="1"],.p$&:hover {color: red;
      }
      "
    `)
  })

  // A class ending in an escaped `&`, before a descendant: the first `& ` in a selector was dropped
  // wherever it stood, the class's own included, which broke the class.
  test('an escaped `&` in a class is the class', () => {
    expect(stringify({ '.c_a\\&': { '.child': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".c_a\\& .child {color: red;
      }
      "
    `)
  })

  // Wrapped in `:is()` only where two references share a line, as `/&.*&/` read it — kept so the
  // same selector resolves as it did.
  test('a combinator parent is wrapped as it was', () => {
    expect(stringify({ '.a .b': { '&:hover\n&': { color: 'red' } } })).toMatchInlineSnapshot(`
      ".a .b:hover
      .a .b {color: red;
      }
      "
    `)
  })
})
