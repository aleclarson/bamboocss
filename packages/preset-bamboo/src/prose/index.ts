import type { Preset } from '@bamboocss/types'
import { DEFAULT_COLOR_PALETTE, DEFAULT_RECIPE_NAME } from './constants'
import { createProseRecipe } from './recipe'
import { createSemanticTokens } from './semantic-tokens'
import type { TypographyPresetOptions } from './types'

/**
 * An opt-in preset styling Markdown and CMS HTML: a `prose` recipe, and the color tokens it reads.
 *
 * Built on this preset's own tokens — `sizes.prose`, the `neutral` palette, the font sizes — so it
 * is listed after the default presets rather than in place of them:
 *
 * ```ts
 * import { defaultPresets, typographyPreset } from '@bamboocss/dev/presets'
 * export default defineConfig({ presets: [...defaultPresets, typographyPreset()] })
 * ```
 */
export function typographyPreset(options: TypographyPresetOptions = {}): Preset {
  const recipes = createProseRecipe(options)
  const tokens = options.semanticTokens?.enabled !== false

  return {
    name: '@bamboocss/preset-bamboo/typography',
    theme: {
      extend: {
        recipes,
        ...(tokens
          ? {
              semanticTokens: createSemanticTokens({
                prefix: options.semanticTokens?.prefix ?? options.name ?? DEFAULT_RECIPE_NAME,
                colorPalette: options.semanticTokens?.colorPalette ?? DEFAULT_COLOR_PALETTE,
              }),
            }
          : {}),
      },
    },
  }
}

export type { ProseSize, SemanticTokensOptions, TypographyPresetOptions } from './types'
