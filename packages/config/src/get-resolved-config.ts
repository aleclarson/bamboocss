import { BambooError, omit, pick, traverse } from '@bamboocss/shared'
import type { Config, BambooHooks, Preset } from '@bamboocss/types'
import { bundle, copyOf, settle } from './bundle-config'
import { mergeConfigs } from './merge-config'
import { rememberExternalPreset, type ExternalPresetProvenance } from './resolution-provenance'

type Extendable<T> = T & { extend?: T }
type ExtendableConfig = Extendable<Config>

const hookUtils = {
  omit,
  pick,
  traverse,
}

/** Why a preset is refused: named by its package, or for a function, by the function's name. */
function notAPreset(preset: unknown, value: unknown) {
  if (typeof preset === 'string') return `Preset \`${preset}\` must export an object.`
  const called =
    typeof value === 'function' && value.name ? `, not the function \`${value.name}\` — was it called?` : '.'
  return `A preset must be an object${called}`
}

/**
 * Recursively merge all presets into a single config (depth-first using stack)
 */
export async function getResolvedConfig(config: ExtendableConfig, cwd: string, hooks?: Partial<BambooHooks>) {
  const stack: ExtendableConfig[] = [config]
  const configs: ExtendableConfig[] = []
  const externalPresets: ExternalPresetProvenance[] = []

  while (stack.length > 0) {
    const current = stack.pop()!

    const subPresets = current.presets ?? []
    for (const subPreset of subPresets) {
      // `false`, as `dark && darkPreset` gives, is left out, as it always was. `null` and
      // `undefined` are not: a misspelled import is one, and is refused below.
      if ((subPreset as unknown) === false) continue
      let presetConfig: ExtendableConfig
      let presetName: string

      if (typeof subPreset === 'string') {
        // Settled already: a promise a module exports is the module's (`bundle`).
        const presetModule = await bundle(subPreset, cwd)
        presetConfig = presetModule.config
        presetName = subPreset
        externalPresets.push({
          dependencies: [...presetModule.dependencies],
          index: externalPresets.length,
          specifier: subPreset,
        })
      } else {
        // A module, `import('./preset')`, as one a package exports is read (`bundle`), and what a
        // promise of `false` gives left out, as `false` written there is.
        presetConfig = copyOf(await settle(subPreset))
        if ((presetConfig as unknown) === false) continue
        presetName = (presetConfig as any)?.name || 'unknown-preset'
      }
      // As a config is (`bundleConfig`): a function or `null` was merged as a preset with nothing
      // in it, or failed on a property of `null`, naming no preset.
      if (typeof presetConfig !== 'object' || presetConfig === null) {
        throw new BambooError('CONFIG_ERROR', `💥 ${notAPreset(subPreset, presetConfig)}`)
      }

      // Call preset:resolved hook if available
      if (hooks?.['preset:resolved']) {
        const resolvedPreset = await hooks['preset:resolved']({
          preset: presetConfig as any,
          name: presetName,
          utils: hookUtils,
        })

        // `false` leaves the preset out, as it always did.
        if ((resolvedPreset as unknown) === false) continue
        if (resolvedPreset !== undefined) {
          if (typeof resolvedPreset !== 'object' || resolvedPreset === null) {
            throw new BambooError(
              'CONFIG_ERROR',
              `💥 The \`preset:resolved\` hook must return an object, or nothing, for preset \`${presetName}\`.`,
            )
          }
          presetConfig = resolvedPreset as ExtendableConfig
        }
      }

      stack.push(presetConfig)
    }

    configs.unshift(current)
  }

  const merged = mergeConfigs(configs) as Config

  // Keep the resolved presets so we can find the origin of a token
  merged.presets = configs.slice(0, -1) as Preset[]

  rememberExternalPreset(merged, externalPresets)

  return merged
}
