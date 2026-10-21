import { createRule } from '../utils'
import { resolveLonghand } from '../utils/helpers'
import { getStyleKey, renameStyleKey } from '../utils/style-key'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'prefer-longhand-properties'

const rule = createRule({
  create(context) {
    const whitelist: string[] = context.options[0]?.whitelist ?? []

    return {
      Property(node: TSESTree.Property) {
        const property = getStyleKey(node, context)
        if (!property || whitelist.includes(property.key.name)) {
          return
        }

        const longhand = resolveLonghand(property.key.name, context)
        if (!longhand || longhand === property.key.name) {
          return
        }

        context.report({
          data: { longhand, shorthand: property.key.name },
          fix: renameStyleKey(property, longhand, context),
          messageId: 'longhand',
          node: property.key,
        })
      },
    }
  },
  defaultOptions: [
    {
      whitelist: [] as string[],
    },
  ],
  meta: {
    docs: {
      description:
        'Discourage the use of shorthand properties and promote the preference for longhand properties in the codebase.',
    },
    fixable: 'code',
    messages: {
      longhand: 'Use longhand property instead of `{{shorthand}}`. Prefer `{{longhand}}`.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
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
    type: 'suggestion',
  },
  name: RULE_NAME,
})

export default rule
