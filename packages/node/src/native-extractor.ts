import type {
  FoldAnalysis,
  NativeAnalysis,
  NativeEntrypoint,
  NativeFileAnalysis,
  NativeFoldOptions,
  NativePathMapping,
  NativeProjectOptions,
  NativeSource,
  NativeTokenAccounting,
} from '@bamboocss/native-extractor'
import { BambooError } from '@bamboocss/shared'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type NativeExtractor = {
  analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
  analyzeMany(
    sources: NativeSource[],
    entrypoints: NativeEntrypoint[],
    options?: NativeProjectOptions,
  ): NativeFileAnalysis[]
  accountTokens(
    filename: string,
    source: string,
    tokenModules: string[],
    pathMappings?: NativePathMapping[],
  ): NativeTokenAccounting
  compileModules(sources: NativeSource[], auxiliary: NativeSource[], options: NativeFoldOptions): FoldAnalysis[]
}

const nativeBinaryName = () => {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64.node'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64.node'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64-gnu.node'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64-gnu.node'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64-msvc.node'
}

/** Load the required Rust extractor from the workspace or the published prebuild directory. */
export const loadNativeExtractor = (): NativeExtractor => {
  const nativeRequire = createRequire(import.meta.url)
  try {
    return nativeRequire('@bamboocss/native-extractor') as NativeExtractor
  } catch (workspaceError) {
    const binary = nativeBinaryName()
    if (!binary) {
      throw new BambooError(
        'NATIVE_EXTRACTION',
        `Native extraction is not available for ${process.platform}-${process.arch}.`,
        { cause: workspaceError },
      )
    }
    try {
      return nativeRequire(join(dirname(fileURLToPath(import.meta.url)), 'native', binary)) as NativeExtractor
    } catch (publishedError) {
      throw new BambooError('NATIVE_EXTRACTION', `Failed to load the native extractor binary ${binary}.`, {
        cause: publishedError,
      })
    }
  }
}
