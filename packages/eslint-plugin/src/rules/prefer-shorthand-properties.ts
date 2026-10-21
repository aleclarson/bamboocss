import { createRule } from '../utils'
import { resolveLonghand, resolveShorthands } from '../utils/helpers'
import { getStyleKey, renameStyleKey } from '../utils/style-key'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'prefer-shorthand-properties'

const rule = createRule({
  create(context) {
    const whitelist: string[] = context.options[0]?.whitelist ?? []

    return {
      Property(node: TSESTree.Property) {
        const property = getStyleKey(node, context)
        if (!property || whitelist.includes(property.key.name)) {
          return
        }

        // Already a shorthand.
        if (resolveLonghand(property.key.name, context)) {
          return
        }

        const shorthands = resolveShorthands(property.key.name, context)
        if (!shorthands?.length) {
          return
        }

        // The shortest, then the first alphabetically, whatever order the config lists them in:
        // `paddingInline` lists `paddingX` before `px`, and `marginInline` `mx` before `marginX`.
        const [shorthand] = [...shorthands].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))

        context.report({
          data: { longhand: property.key.name, shorthand },
          fix: renameStyleKey(property, shorthand, context),
          messageId: 'shorthand',
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
        'Discourage the use of longhand properties and promote the preference for shorthand properties in the codebase.',
    },
    fixable: 'code',
    messages: {
      shorthand: 'Use shorthand property instead of `{{longhand}}`. Prefer `{{shorthand}}`.',
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
