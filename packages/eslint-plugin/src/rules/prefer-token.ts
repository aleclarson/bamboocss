import { createRule } from '../utils'
import { getAncestor, getTokensWithValue, isBambooAttribute, isRecipeCall } from '../utils/helpers'
import { isCallExpression, isLiteral, isTemplateLiteral } from '../utils/nodes'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'prefer-token'

const keyName = (key: TSESTree.Node) =>
  key.type === 'Identifier' ? key.name : key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined

/**
 * The keys from a property out to the call it is in, innermost first: `padding: { md: '1rem' }`
 * gives `md`, then `padding`, the property the value is for.
 */
const keysOf = (node: TSESTree.Property) => {
  const keys: string[] = []
  let current: TSESTree.Node | undefined = node
  while (current && current.type !== 'CallExpression') {
    const key = current.type === 'Property' && !current.computed ? keyName(current.key) : undefined
    if (key) keys.push(key)
    current = current.parent as TSESTree.Node | undefined
  }
  return keys
}

/**
 * Whether a property selects a variant rather than styling one: under a recipe's `defaultVariants`,
 * or among a compound variant's conditions beside its `css`. Its value names a variant, and a token
 * written in its place would select none.
 */
const isVariantSelection = (node: TSESTree.Property) => {
  let current = node.parent as TSESTree.Node | undefined
  while (current && current.type !== 'CallExpression') {
    if (current.type === 'Property' && !current.computed) {
      const key = keyName(current.key)
      if (key === 'defaultVariants') return true
      if (key === 'css') return false
    }
    if (current.type === 'ArrayExpression' && current.parent?.type === 'Property') {
      if (keyName(current.parent.key) === 'compoundVariants') return true
    }
    current = current.parent as TSESTree.Node | undefined
  }
  return false
}

/**
 * A value written out that a token of the property's category holds: `padding: '1rem'` where
 * `spacing.4` is `1rem`. It renders the same today, and stops following the theme the day the
 * token changes. Reported only where a token holds exactly the value, which is then the
 * suggestion — not every value that is no token, which would be every value the theme does not
 * cover.
 */
const rule = createRule({
  create(context) {
    const check = (node: TSESTree.Literal | TSESTree.TemplateLiteral, properties: string[], value: string) => {
      const { category, tokens } = getTokensWithValue(properties, value, context)
      if (!tokens.length) return
      // In the quote the value was written in.
      const quote = node.type === 'Literal' && node.raw.startsWith('"') ? '"' : "'"
      const literal = (token: string) => quote + token.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`) + quote
      context.report({
        data: { category, token: tokens[0], value },
        messageId: 'preferToken',
        node,
        suggest: tokens.map((token) => ({
          data: { token },
          fix: (fixer) => fixer.replaceText(node, literal(token)),
          messageId: 'replace' as const,
        })),
      })
    }

    /** A style, or a value of one under a condition: `base` in `padding: { base: '1rem' }`. */
    const isStyle = (node: TSESTree.Property) => {
      let current: TSESTree.Node | undefined = node
      while (current && current.type !== 'CallExpression') {
        if (current.type === 'Property' && isBambooAttribute(current, context)) return true
        current = current.parent as TSESTree.Node | undefined
      }
      return false
    }

    const checkValue = (properties: string[], node: TSESTree.Node | null) => {
      if (!node) return
      // `padding: ['1rem', '2rem']`, one value per breakpoint.
      if (node.type === 'ArrayExpression') {
        for (const element of node.elements) checkValue(properties, element as TSESTree.Node | null)
        return
      }
      if (isLiteral(node) && (typeof node.value === 'string' || typeof node.value === 'number')) {
        check(node, properties, String(node.value))
      } else if (isTemplateLiteral(node) && node.expressions.length === 0) {
        check(node, properties, node.quasis[0]!.value.cooked ?? '')
      }
    }

    /** A value the rule reads: a literal, a template with nothing in it, or a list of them. */
    const isValue = (node: TSESTree.Node) =>
      node.type === 'Literal' ||
      node.type === 'ArrayExpression' ||
      (isTemplateLiteral(node) && !node.expressions.length)

    // Not JSX props: with the JSX factory gone, an attribute is a component's prop — a recipe's
    // variant, say — never a style.
    return {
      Property(node: TSESTree.Property) {
        if (node.computed || !keyName(node.key) || !isValue(node.value)) return
        if (isVariantSelection(node) || !isStyle(node)) return
        const call = getAncestor(isCallExpression, node)
        if (call && isRecipeCall(call, context)) return
        checkValue(keysOf(node), node.value)
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Prefer a token to a value written out that the token holds.',
    },
    hasSuggestions: true,
    messages: {
      preferToken:
        '`{{value}}` is the `{{category}}` token `{{token}}`. Write the token, so the value follows the theme.',
      replace: 'Write `{{token}}`.',
    },
    schema: [],
    type: 'suggestion',
  },
  name: RULE_NAME,
})

export default rule
