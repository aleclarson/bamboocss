import { createRule } from '../utils'
import { isBambooAttribute, isBambooProp as isBambooProperty, isRecipeVariant } from '../utils/helpers'
import { isIdentifier, isJSXExpressionContainer, isLiteral, isTemplateLiteral } from '../utils/nodes'
import { isImportant, withoutImportant } from '@bamboocss/shared'
import { type TSESTree } from '@typescript-eslint/utils'

// The keyword as the author wrote it, for the message. Which values are important, and what
// removing the mark leaves, is decided by `isImportant` and `withoutImportant` — the predicates
// the build itself uses — so a value the build marks is one this reports, and a `!` the build
// leaves in the value is not.
const keywordRegex = /!important/i

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

    // Unified function to handle reporting
    const handleNodeValue = (node: TSESTree.Node, value: string) => {
      if (!value || !isImportant(value)) {
        return
      }

      // Every mark goes, as the build strips every one, and an escape hatch keeps its brackets.
      const fixed = String(withoutImportant(value))
      const keyword = keywordRegex.exec(value)?.[0] ?? '!'

      context.report({
        data: { keyword },
        messageId: 'important',
        node,
        suggest: [
          {
            data: { keyword },
            fix: (fixer) => {
              return fixer.replaceTextRange(removeQuotes(node.range as [number, number]), fixed)
            },
            messageId: 'remove',
          },
        ],
      })
    }

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
          handleNodeValue(valueNode, value)
        } else if (isJSXExpressionContainer(valueNode)) {
          const expr = valueNode.expression

          if (isLiteral(expr)) {
            const value = expr.value?.toString() ?? ''
            handleNodeValue(expr, value)
          } else if (isTemplateLiteral(expr) && expr.expressions.length === 0) {
            const value = expr.quasis[0].value.raw
            handleNodeValue(expr.quasis[0], value)
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
          const value = valueNode.value?.toString() ?? ''
          handleNodeValue(valueNode, value)
        } else if (isTemplateLiteral(valueNode) && valueNode.expressions.length === 0) {
          const value = valueNode.quasis[0].value.raw
          handleNodeValue(valueNode.quasis[0], value)
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
