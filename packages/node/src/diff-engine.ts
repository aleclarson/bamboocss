import { diffConfigs, loadConfig } from '@bamboocss/config'
import { Generator } from '@bamboocss/generator'
import type { Config, LoadConfigResult } from '@bamboocss/types'
import { configReloadOf } from './config-reload'
import { getTsConfigResolutionFiles, loadTsConfig, rememberTsConfigResolutionFiles } from './load-tsconfig'

const applyTsConfig = (
  conf: LoadConfigResult,
  next: Pick<LoadConfigResult, 'tsconfig' | 'tsconfigFile' | 'tsOptions'> | Awaited<ReturnType<typeof loadTsConfig>>,
) => {
  // Assign every field, including `undefined`: a removed tsconfig must retract the previous
  // paths/baseUrl rather than leaving them attached to the otherwise fresh Bamboo config.
  conf.tsconfig = next?.tsconfig ?? {}
  conf.tsconfigFile = next?.tsconfigFile
  conf.tsOptions = next?.tsOptions
}

export class DiffEngine {
  private prevConfig: Config | undefined

  constructor(private ctx: Generator) {
    this.prevConfig = ctx.conf.deserialize()
  }

  /**
   * Reload config from disk and refresh the context
   */
  async reloadConfigAndRefreshContext(fn?: (conf: LoadConfigResult) => void) {
    // As it was prepared, where an integration prepared it. @see rememberConfigReload
    const reload = configReloadOf(this.ctx.conf)
    const conf = reload ? await reload() : await this.readAgain()

    const affected = this.refresh(conf, fn)
    if (!affected.hasConfigChanged) {
      // Keep the existing Context/encoder when only TypeScript resolution changed. Builder
      // invalidates the exact semantic owners after comparing the recorded config bytes.
      applyTsConfig(this.ctx.conf, conf)
      rememberTsConfigResolutionFiles(this.ctx.conf, getTsConfigResolutionFiles(conf))
      // What the config is built from can change while what it resolves to does not — tokens moved
      // into a module it imports. The context kept has to know the files the next edit can land in.
      this.ctx.conf.dependencies = conf.dependencies
    }
    return affected
  }

  /** The file read again, and its tsconfig, for a context no integration prepared. */
  private readAgain = async () => {
    const conf = await loadConfig({ cwd: this.ctx.config.cwd, file: this.ctx.conf.path })
    const resolutionFiles: { value?: readonly string[] } = {}
    applyTsConfig(conf, await loadTsConfig(conf, conf.config.cwd || this.ctx.config.cwd, resolutionFiles))
    rememberTsConfigResolutionFiles(conf, resolutionFiles.value ?? [])
    return conf
  }

  /** @internal Exact tsconfig files behind the currently attached resolution options. */
  getResolutionConfigFiles = (): readonly string[] => getTsConfigResolutionFiles(this.ctx.conf)

  /**
   * Update the context from the refreshed config
   * then persist the changes on each affected engines
   * Returns the list of affected artifacts/engines
   */
  refresh(conf: LoadConfigResult, fn?: (conf: LoadConfigResult) => void) {
    const affected = diffConfigs(() => conf.deserialize(), this.prevConfig)

    if (!affected.hasConfigChanged || !this.prevConfig) return affected

    fn?.(conf)
    this.prevConfig = conf.deserialize()

    return affected
  }
}
