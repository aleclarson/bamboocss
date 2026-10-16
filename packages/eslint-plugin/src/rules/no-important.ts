import { createRule } from '../utils'
import { isBambooAttribute, isBambooProp as isBambooProperty, isRecipeVariant } from '../utils/helpers'
import { isIdentifier, isJSXExpressionContainer, isLiteral, isTemplateLiteral } from '../utils/nodes'
import { importantMark, isImportant, withoutImportant } from '@bamboocss/shared'
import { type TSESTree } from '@typescript-eslint/utils'

// Which values are important, what removing the mark leaves, and the mark the message quotes are
// all decided by `isImportant`, `withoutImportant` and `importantMark` — the build's own — so a
// value the build marks is one this reports, a `!` the build leaves in the value is not, and the
// keyword named is the one the fix removes. Its whitespace is collapsed, so a mark split across
// lines in a template literal does not split the message.
const keywordOf = (value: string) => (importantMark(value) ?? '!').replaceAll(/\s+/g, ' ')

// The fix writes the value back as source, so it is escaped the way its literal reads: a string
// literal for its quote, a template for its backtick and `${`. Written as the value reads, `"\"hi\"
// !"` became `""hi""`, and `'a\\\\! !'` came back with an escape fewer and a mark again.
const inString = (quote: string) => (value: string) =>
  value.replaceAll(/[\\\n\r\u2028\u2029'"]/g, (character) => {
    if (character === '\\') return '\\\\'
    if (character === '\n') return '\\n'
    if (character === '\r') return '\\r'
    if (character === '\u2028') return '\\u2028'
    if (character === '\u2029') return '\\u2029'
    return character === quote ? `\\${character}` : character
  })

const inTemplate = (value: string) => value.replaceAll(/\\|`|\$\{/g, (match) => `\\${match}`)

// A JSX attribute's string has no escapes, and an entity in it is read as its character, so the
// value is written back only where its text is the value.
const inAttribute = (text: string, value: string) => (fixed: string) => (text === value ? fixed : undefined)

export const RULE_NAME = 'no-important'

const rule = createRule({
  create(context) {
    // Helper function to adjust the range for fixing (removing quotes)
    const removeQuotes = (range: readonly [number, number]) => {
      const [start, end] = range
      return [start + 1, end - 1] as const
    }

    // Caches for helper functions
    const bambooPropertyCache = new WeakMap<TSESTree.JSXAttribute, boolean | undefined>()
    const bambooAttributeCache = new WeakMap<TSESTree.Property, boolean | undefined>()
    const recipeVariantCache = new WeakMap<TSESTree.Property, boolean | undefined>()

    // Cached version of isBambooProp
    const isCachedBambooProperty = (node: TSESTree.JSXAttribute): boolean => {
      if (bambooPropertyCache.has(node)) {
        return bambooPropertyCache.get(node)!
      }

      const result = isBambooProperty(node, context)
      bambooPropertyCache.set(node, result)
      return Boolean(result)
    }

    // Cached version of isBambooAttribute
    const isCachedBambooAttribute = (node: TSESTree.Property): boolean => {
      if (bambooAttributeCache.has(node)) {
        return bambooAttributeCache.get(node)!
      }

      const result = isBambooAttribute(node, context)
      bambooAttributeCache.set(node, result)
      return Boolean(result)
    }

    // Cached version of isRecipeVariant
    const isCachedRecipeVariant = (node: TSESTree.Property): boolean => {
      if (recipeVariantCache.has(node)) {
        return recipeVariantCache.get(node)!
      }

      const result = isRecipeVariant(node, context)
      recipeVariantCache.set(node, result)
      return Boolean(result)
    }

    // Unified function to handle reporting. `write` gives the source for the fixed value between
    // the node's delimiters, or nothing where it cannot be written there.
    const handleNodeValue = (node: TSESTree.Node, value: string, write: (fixed: string) => string | undefined) => {
      if (!value || !isImportant(value)) {
        return
      }

      // Every mark goes, as the build strips every one, and an escape hatch keeps its brackets.
      const fixed = write(String(withoutImportant(value)))
      const keyword = keywordOf(value)

      context.report({
        data: { keyword },
        messageId: 'important',
        node,
        suggest:
          fixed === undefined
            ? []
            : [
                {
                  data: { keyword },
                  fix: (fixer) => fixer.replaceTextRange(removeQuotes(node.range as [number, number]), fixed),
                  messageId: 'remove',
                },
              ],
      })
    }

    // A string literal's value, and how a fixed one is written back into it.
    const literal = (node: TSESTree.Literal) => {
      const value = node.value?.toString() ?? ''
      return [value, inString(node.raw[0] ?? "'")] as const
    }

    // A template written with nothing interpolated: its value is what it cooks to, as the build reads it.
    const template = (node: TSESTree.TemplateLiteral) => [node.quasis[0].value.cooked ?? '', inTemplate] as const

    return {
      // JSX Attributes
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (!node.value) {
          return
        }

        if (!isCachedBambooProperty(node)) {
          return
        }

        const valueNode = node.value

        if (isLiteral(valueNode)) {
          const value = valueNode.value?.toString() ?? ''
          handleNodeValue(valueNode, value, inAttribute(valueNode.raw.slice(1, -1), value))
        } else if (isJSXExpressionContainer(valueNode)) {
          const expr = valueNode.expression

          if (isLiteral(expr)) {
            handleNodeValue(expr, ...literal(expr))
          } else if (isTemplateLiteral(expr) && expr.expressions.length === 0) {
            handleNodeValue(expr.quasis[0], ...template(expr))
          }
        }
      },

      // Object Properties
      Property(node: TSESTree.Property) {
        if (!isIdentifier(node.key)) {
          return
        }

        if (!isCachedBambooAttribute(node)) {
          return
        }

        if (isCachedRecipeVariant(node)) {
          return
        }

        const valueNode = node.value

        if (isLiteral(valueNode)) {
          handleNodeValue(valueNode, ...literal(valueNode))
        } else if (isTemplateLiteral(valueNode) && valueNode.expressions.length === 0) {
          handleNodeValue(valueNode.quasis[0], ...template(valueNode))
        }
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        'Disallow usage of !important keyword. Prioritize specificity for a maintainable and predictable styling structure.',
    },
    hasSuggestions: true,
    messages: {
      important:
        'Avoid using the {{keyword}} keyword. Refactor your code to prioritize specificity for predictable styling.',
      remove: 'Remove the `{{keyword}}` keyword.',
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
