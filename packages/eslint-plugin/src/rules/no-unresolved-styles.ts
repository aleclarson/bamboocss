import { createRule } from '../utils'
import { getUnresolvedStyles } from '../utils/helpers'

export const RULE_NAME = 'no-unresolved-styles'

/**
 * What the build warns about, where it is written: a style it could not read, whose declarations
 * never reach the stylesheet. The build's own extraction and the build's own sentence — not a
 * second guess at what is dynamic, as `no-dynamic-styling` makes — so it reports exactly the
 * styles the build will drop, and none it reads.
 */
const rule = createRule({
  create(context) {
    return {
      'Program:exit'() {
        for (const { column, fix, line, what } of getUnresolvedStyles(context)) {
          context.report({ data: { fix, what }, loc: { column: column - 1, line }, messageId: 'unresolved' })
        }
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Report styles the build cannot read, whose declarations never reach the stylesheet.',
    },
    messages: {
      unresolved: '{{what}}. {{fix}}',
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
