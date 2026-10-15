interface Watcher {
  on(event: 'add' | 'addDir' | 'change', listener: (path: string) => void): this
  on(event: 'all', listener: (evt: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', path: string) => void): this
  close(): Promise<void>
}

interface InputOptions {
  include: string[]
  exclude?: string[]
  cwd?: string
}

interface GlobOptions extends InputOptions {
  /**
   * Filled with every folder the glob began a walk at, and every folder or file it reached through
   * a symbolic link, as it spelled them: where a path it returns may really be somewhere else.
   */
  linked?: string[]
}

export type WatcherEventType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

export interface WatchOptions extends InputOptions {
  poll?: boolean
}

interface FileSystem {
  readDirSync(dir: string): string[]
  existsSync(fileLike: string): boolean
  /** False for a path that does not exist, so a caller never has to test twice. */
  isDirSync(path: string): boolean
  glob(opts: GlobOptions): string[]
  readFileSync(filePath: string): string
  rmDirSync(dirPath: string): void
  writeFile(file: string, content: string): Promise<void>
  rmFileSync(file: string): void
  ensureDirSync(dirPath: string): void
  writeFileSync(filePath: string, content: string): void
  watch(options: WatchOptions): Watcher
}

interface Path {
  join(...paths: string[]): string
  dirname(path: string): string
  resolve(...paths: string[]): string
  extname(path: string): string
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
  sep: string
  abs(cwd: string, path: string): string
}

export interface Runtime {
  fs: FileSystem
  path: Path
  cwd(): string
  env(name: string): string | undefined
}
