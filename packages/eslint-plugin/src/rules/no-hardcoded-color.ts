import { createRule } from '../utils'
import {
  extractTokens,
  getAncestor,
  getStyleProperty,
  isBambooProp as isBambooProperty,
  isInBambooStyle,
  isRecipeCall,
  isVariantSelection,
  isColorAttribute as originalIsColorAttribute,
  isColorToken as originalIsColorToken,
} from '../utils/helpers'
import {
  isCallExpression,
  isJSXExpressionContainer,
  isJSXIdentifier,
  isLiteral,
  isTemplateLiteral,
} from '../utils/nodes'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'no-hardcoded-color'

const rule = createRule({
  create(context) {
    const noOpacity = context.options[0]?.noOpacity
    const whitelist: string[] = context.options[0]?.whitelist ?? []

    // Caches for isColorToken and isColorAttribute results
    const colorTokenCache = new Map<string, boolean | undefined>(whitelist?.map((item) => [item, true]))
    const colorAttributeCache = new Map<string, boolean>()

    // Cached version of isColorToken
    const isColorToken = (token: string): boolean => {
      if (colorTokenCache.has(token)) {
        return colorTokenCache.get(token)!
      }

      const result = originalIsColorToken(token, context)
      colorTokenCache.set(token, result)
      return Boolean(result)
    }

    // Cached version of isColorAttribute
    const isColorAttribute = (attribute: string): boolean => {
      if (colorAttributeCache.has(attribute)) {
        return colorAttributeCache.get(attribute)!
      }

      const result = originalIsColorAttribute(attribute, context)
      colorAttributeCache.set(attribute, result)
      return result
    }

    const isTokenFunctionUsed = (value: string): boolean => {
      if (!value) {
        return false
      }

      const tokens = extractTokens(value)
      return tokens.length > 0
    }

    const isValidColorToken = (value: string): boolean => {
      if (!value) {
        return false
      }

      const [colorToken, opacity] = value.split('/')
      const hasOpacity = opacity !== undefined && opacity.length > 0
      const isValidToken = isColorToken(colorToken)

      return noOpacity ? isValidToken && !hasOpacity : isValidToken
    }

    const reportInvalidColor = (node: TSESTree.Node, color: string) => {
      context.report({
        data: {
          color,
        },
        messageId: 'invalidColor',
        node,
      })
    }

    const checkColorValue = (node: TSESTree.Node, value: string, attributeName: string) => {
      if (!isColorAttribute(attributeName)) {
        return
      }

      if (isTokenFunctionUsed(value)) {
        return
      }

      if (isValidColorToken(value)) {
        return
      }

      reportInvalidColor(node, value)
    }

    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (!isJSXIdentifier(node.name)) {
          return
        }

        if (!isBambooProperty(node, context) || !node.value) {
          return
        }

        const attributeName = node.name.name
        const valueNode = node.value

        if (isLiteral(valueNode)) {
          const value = valueNode.value?.toString() || ''
          checkColorValue(valueNode, value, attributeName)
        } else if (isJSXExpressionContainer(valueNode)) {
          const expression = valueNode.expression
          if (isLiteral(expression)) {
            const value = expression.value?.toString() || ''
            checkColorValue(expression, value, attributeName)
          } else if (isTemplateLiteral(expression) && expression.expressions.length === 0) {
            const value = expression.quasis[0].value.raw
            checkColorValue(expression.quasis[0], value, attributeName)
          }
        }
      },

      Property(node: TSESTree.Property) {
        const valueNode = node.value
        const isWrittenOut =
          isLiteral(valueNode) || (isTemplateLiteral(valueNode) && valueNode.expressions.length === 0)

        // The tree first: this runs for every key in every file, and most are nothing of bamboo's.
        if (!isWrittenOut || !isInBambooStyle(node, context)) {
          return
        }

        // A value under `base` or a condition is one of the property holding it —
        // `color: { base: '#ef4444', _hover: '#dc2626' }` — and a quoted key is a property like any
        // other. A computed key is whatever its expression holds, not the name it is written with.
        const property = getStyleProperty(node, context)
        if (!property || property.node.computed) {
          return
        }

        // Not a variant being chosen — the argument a recipe is called with, `defaultVariants`, a
        // compound variant's conditions — whose value names a variant, whatever style its axis
        // shares a name with: `color: 'loud'`. Where a recipe declares its variants, every value
        // written out is a style's.
        const call = getAncestor(isCallExpression, node)
        if (isVariantSelection(property.node) || (call && isRecipeCall(call, context))) {
          return
        }

        // Only a colour property is checked, so a key in the call that is no style goes no further.
        if (isLiteral(valueNode)) {
          checkColorValue(valueNode, valueNode.value?.toString() || '', property.name)
        } else if (isTemplateLiteral(valueNode)) {
          checkColorValue(valueNode.quasis[0], valueNode.quasis[0].value.raw, property.name)
        }
      },
    }
  },
  defaultOptions: [
    {
      noOpacity: false,
      whitelist: [],
    },
  ],
  meta: {
    docs: {
      description: 'Enforce the exclusive use of design tokens as values for colors within the codebase.',
    },
    messages: {
      invalidColor: '`{{color}}` is not a valid color token.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          noOpacity: {
            type: 'boolean',
          },
          whitelist: {
            items: {
              minLength: 0,
              type: 'string',
            },
            type: 'array',
            uniqueItems: true,
          },
        },
        type: 'object',
      },
    ],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
