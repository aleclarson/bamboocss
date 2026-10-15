import { convertTsPathsToRegexes } from '@bamboocss/config'
import {
  declaresAliases,
  findClosestTsconfig,
  globBase,
  includesUnder,
  isSolutionTsconfig,
  isSourceFileIncludedInTsconfig,
  readTsconfigGraph,
  resolveDirectTsconfigJson,
  resolvePathsBase,
  type TsconfigProject,
} from '@bamboocss/config/tsconfig'
import type { LoadConfigResult, LoadTsConfigResult } from '@bamboocss/types'
import path from 'node:path'

/**
 * What each `include` glob reaches: the file it names, or the directory up to its first segment
 * with a glob character in it — braces and brackets too, in this syntax. A negation reaches none.
 */
const includeTargets = (include: readonly string[] | undefined, cwd: string) =>
  (include ?? []).flatMap((glob): Array<{ file?: string; directory?: string }> => {
    if (glob.startsWith('!')) return []
    const { base, wildcard } = globBase(glob, /[*?{}[\]!()]/)
    const target = path.resolve(cwd, base)
    return [wildcard || !path.extname(base) ? { directory: target } : { file: target }]
  })

/**
 * Exact tsconfig files read while producing one resolved Node config.
 *
 * This metadata is deliberately kept outside `LoadConfigResult`: it is incremental resolver
 * provenance, not Bamboo configuration, and must therefore neither participate in
 * `diffConfigs` nor become part of the public/serialized config shape.
 */
const resolutionFilesByConfig = new WeakMap<object, readonly string[]>()

export const rememberTsConfigResolutionFiles = (conf: LoadConfigResult, files: Iterable<string>) => {
  resolutionFilesByConfig.set(conf, Object.freeze([...new Set(files)].sort()))
}

export const getTsConfigResolutionFiles = (conf: LoadConfigResult): readonly string[] =>
  resolutionFilesByConfig.get(conf) ?? Object.freeze(conf.tsconfigFile ? [path.resolve(conf.tsconfigFile)] : [])

export async function loadTsConfig(
  conf: LoadConfigResult,
  cwd: string,
  resolutionFiles?: { value?: readonly string[] },
): Promise<LoadTsConfigResult | undefined> {
  let tsconfigFile: string | null = await resolveDirectTsconfigJson(conf.path)
  if (!tsconfigFile) {
    if (resolutionFiles) resolutionFiles.value = Object.freeze([])
    tsconfigFile = await findClosestTsconfig(conf.path, cwd, 'tsconfig.json')
  }

  if (!tsconfigFile) {
    return {
      tsconfig: {},
      tsconfigFile: undefined,
    }
  }

  const graph = await readTsconfigGraph(tsconfigFile)
  // A JavaScript config resolves through the root, as it always has.
  const configFile = path.resolve(conf.path)
  let effective = (/\.[cm]?tsx?$/.test(configFile) && graph.projectIncluding(configFile)) || graph.root
  // These resolve the sources, not the config file. Under a solution-style root, which compiles
  // nothing itself, the two are in different projects: `create vite` puts the sources and their
  // aliases in `tsconfig.app.json`, and the config beside the root or in `tsconfig.node.json`.
  // Found through the config, an aliased import in a source resolved nowhere. So it is the first
  // project including files where `include` points and declaring aliases — a broad `include`
  // reaches `tsconfig.node.json` too, which declares none. With none, what resolved them before.
  // `include` is globbed from the config's `cwd`, and so is read from it here.
  //
  // The project that would include a source there, as TypeScript reads its `include`, `exclude` and
  // extensions — the file a glob names, or one standing for those directly in the directory it
  // reaches, in both extensions. Failing that, one reaching into that directory at all, as a
  // project listing its files one by one does, or one including only deeper directories.
  if (isSolutionTsconfig(graph.root.tsconfig)) {
    const targets = includeTargets(conf.config?.include, conf.config?.cwd ? path.resolve(conf.config.cwd) : cwd)
    const probes = targets.flatMap(({ file, directory }) =>
      file ? [file] : [path.join(directory!, '__bamboo__.ts'), path.join(directory!, '__bamboo__.tsx')],
    )
    const includes = ({ tsconfig, tsconfigFile }: TsconfigProject) =>
      probes.some((probe) => isSourceFileIncludedInTsconfig(probe, tsconfigFile, tsconfig))
    const reaches = (project: TsconfigProject) =>
      targets.some(({ directory }) => directory !== undefined && includesUnder(directory, project))
    const sources =
      graph.find((project) => declaresAliases(project) && includes(project)) ??
      graph.find((project) => declaresAliases(project) && reaches(project))
    if (sources) effective = sources
  }

  let { tsconfig } = effective
  const effectiveTsconfigPath = effective.tsconfigFile
  // TypeScript resolves `baseUrl`, and `paths` without one, against the directory of the tsconfig
  // declaring them, and the resolver joins both to `cwd` — the same place only for a tsconfig
  // there. Absolute, they resolve the same against either. No `baseUrl` is set where none is
  // written, which would change how every bare specifier resolves.
  const compilerOptions = tsconfig.compilerOptions
  const base = resolvePathsBase(tsconfig, effectiveTsconfigPath, cwd)
  if (compilerOptions && (compilerOptions.baseUrl != null || compilerOptions.paths)) {
    tsconfig = {
      ...tsconfig,
      compilerOptions:
        compilerOptions.baseUrl != null
          ? { ...compilerOptions, baseUrl: base }
          : {
              ...compilerOptions,
              paths: Object.fromEntries(
                Object.entries(compilerOptions.paths!).map(([pattern, targets]) => [
                  pattern,
                  targets.map((target) => path.resolve(base, target)),
                ]),
              ),
            },
    }
  }

  const result: LoadTsConfigResult = {
    tsconfig,
    tsconfigFile: effectiveTsconfigPath,
  }

  if (resolutionFiles) {
    resolutionFiles.value = Object.freeze([...new Set(graph.files())].sort())
  }

  if (tsconfig.compilerOptions?.paths) {
    result.tsOptions = {
      baseUrl: tsconfig.compilerOptions.baseUrl,
      pathMappings: convertTsPathsToRegexes(tsconfig.compilerOptions.paths, base),
    }
  }

  return result
}
