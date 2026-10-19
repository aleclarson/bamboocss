import { logger } from '@bamboocss/logger'
import type { Runtime } from '@bamboocss/types'
import chokidar from 'chokidar'
import glob from 'fast-glob'
import fsExtra from 'fs-extra'
import { readdirSync, realpathSync, statSync, type Stats, type StatSyncOptions } from 'node:fs'
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import picomatch from 'picomatch'
import { globDirname } from './glob-dirname'

/**
 * What the source glob ignores.
 *
 * `**\/*.d.ts` is unconditional. It used to be a *default* that a user's own `exclude`
 * replaced, so declaration files were scanned by whether the project happened to set that
 * option at all — excluded for `exclude: []`, included for `exclude: ['**\/*.stories.tsx']`.
 * Nothing chose that; the default was simply appended when nothing else was there.
 *
 * A declaration file carries no runtime code and can emit no styles. It is still read by the
 * reference scans, which are deliberately over-inclusive, so scanning one could keep a token
 * named in a doc comment or a reset rule for an element named in a JSDoc example. Those are
 * spurious keeps rather than a guarantee anyone relied on — and they were never available to
 * the projects on the other side of the same condition.
 *
 * Copied rather than appended to. `opts.exclude` is `ctx.config.exclude` itself, so pushing
 * onto it edited the user's resolved config in place, and the next call then saw a list it had
 * mutated.
 */
export const globIgnore = (exclude: string[] | undefined) => ['**/*.d.ts', ...(exclude ?? [])]

/** Patterns that name what to read, apart from those, `!`-led, that name what to pass over. */
export const splitPatterns = (patterns: readonly string[]) => {
  const positive: string[] = []
  const negative: string[] = []
  for (const pattern of patterns) {
    if (picomatch.scan(pattern).negated) negative.push(pattern.slice(1))
    else positive.push(pattern)
  }
  return { negative, positive }
}

/**
 * Whether a `cwd`-relative, `/`-spelled path is one the source glob returns for `include` and
 * `exclude`, told without walking: what decides a file's membership when it appears, and whether
 * the compiler reads a module.
 *
 * As the glob reads the two, which a matcher handed the same lists does not:
 *
 * - A negated `include` pattern — `!src/legacy/**` — is one more thing to pass over, where such a
 *   matcher matches every path it does not name: `README.md`, and each module in `node_modules`,
 *   was a source. So is a negated `exclude` pattern, which the glob reads without its `!`.
 * - A file passed over is matched with hidden paths in reach, so `**\/*.d.ts` drops one under
 *   `.storybook` that `include` names, though a wildcard of `include`'s own does not enter it.
 * - A folder the walk meets below where it began, with a name an ignore matches outright —
 *   `src/legacy`, `**\/legacy`, not `src/legacy/*` — is not read: nothing in it is a source. The
 *   folder a walk begins at is never tested, so `src/legacy/**` beside `exclude: ['src/legacy']`
 *   reads it, and a pattern without a glob — looked up in its own folder — is one wherever it is.
 * - A pattern is matched as its own walk spells what it meets: one written as an absolute path
 *   against where a file is from the root, and every other against where it is from `cwd` — so
 *   `**\/*.tsx` reaches nothing above `cwd`, and an absolute `exclude` beside a relative `include`
 *   passes over nothing, as the glob passes over nothing for it.
 */
export const sourceMatcher = (
  include: readonly string[] = [],
  exclude?: string[],
  cwd: string = process.cwd(),
): ((path: string) => boolean) => {
  const { negative, positive } = splitPatterns(include)
  // As written: the glob resolves `..` in what it reads from, not in what it passes over.
  const ignore = [
    ...negative,
    ...globIgnore(exclude).map((pattern) => (pattern.startsWith('!') ? pattern.slice(1) : pattern)),
  ]
  const read = positive.map(resolveDots)
  // Each walk matches what it meets as its own patterns spell it: from `cwd`, or from the root.
  const fromCwd = membership(
    read.filter((pattern) => !isAbsolute(pattern)),
    ignore,
    cwd,
  )
  const absolute = read.filter((pattern) => isAbsolute(pattern))
  // Spelled with `/`, as the glob spells it: a watcher on Windows hands over `\`.
  const spelled = (input: string) => (input.includes('\\') ? slashes(input) : input)
  if (!absolute.length) return (input) => fromCwd(spelled(input))
  const fromRoot = membership(absolute, ignore, cwd)
  const root = slashes(cwd)
  return (input) => {
    const path = spelled(input)
    return fromCwd(path) || fromRoot(posix.join(root, path))
  }
}

/** A pattern with `.` and `..` segments resolved, as the walk resolves them on its way down. */
const resolveDots = (pattern: string) =>
  pattern.startsWith('./') || pattern.includes('/./') || pattern.includes('/../') ? posix.normalize(pattern) : pattern

/** As `sourceMatcher` tells it, for patterns all spelled the one way — and paths spelled so. */
const membership = (read: string[], ignore: string[], cwd: string): ((path: string) => boolean) => {
  if (!read.length) return () => false
  // `/` in a path and `\` an escape, on every platform, as the glob reads them.
  const options = { windows: false }
  // As written — braces and all, one test each — and what is passed over only once that matches,
  // so a module no pattern reaches costs no more than the patterns.
  const matches = picomatch(read, options)
  const ignored = picomatch(ignore, { ...options, dot: true })
  const member = (path: string) => matches(path) && !ignored(path)

  // Those that stop the walk at a folder: a name without a glob, which it tests a folder against
  // — with its own reading of a hidden name, unlike what it tests a file against.
  const folderIgnore = ignore.filter(
    (pattern) => !pattern.endsWith('/**') && !glob.isDynamicPattern(posix.basename(pattern)),
  )
  if (!folderIgnore.length) return member

  // By the folder each is read from — a pattern without a glob too, which is looked up in its own
  // folder, so that nothing lies between where it is read from and the file.
  const walks = byWalk(
    glob.generateTasks(read, { cwd }).flatMap((task) => task.positive),
    cwd,
  )
  let stops = false
  const reads = [...walks].map(([base, patterns]) => {
    // With one walk, the patterns as written already said that it reaches the path.
    const inWalk = walks.size === 1 ? () => true : picomatch(patterns, options)
    // Not the folder a walk begins at, nor one above it: the walk never tests those.
    const skipped = folderIgnore.filter((pattern) => !picomatch([pattern, `${pattern}/**`], options)(base))
    if (!skipped.length) return inWalk
    stops = true
    const inSkipped = picomatch(
      skipped.map((pattern) => `${pattern}/**`),
      options,
    )
    return (path: string) => inWalk(path) && !inSkipped(path)
  })
  // Read by some walk that reaches it, and was not stopped short of it.
  return stops ? (path) => member(path) && reads.some((read) => read(path)) : member
}

/** Patterns by the folder each is walked from when alone, as the source glob walks them. */
const byWalk = (patterns: readonly string[], cwd: string | undefined) => {
  const walks = new Map<string, string[]>()
  for (const pattern of patterns) {
    const base = glob.generateTasks([pattern], { cwd })[0]?.base ?? '.'
    walks.set(base, [...(walks.get(base) ?? []), pattern])
  }
  return walks
}

/**
 * The order the source glob returns files in, made a decision rather than an accident.
 *
 * `fast-glob` hands back whatever `readdir` gave it, which is the filesystem's order and is not
 * the same on every machine. That order is not cosmetic: it is the order atoms enter the sheet,
 * and sheet order is what decides a conflict between two classes on one element — `cx` joins
 * them and the browser picks by position, not by the order they were passed. So an unsorted
 * glob lets two checkouts of the same commit build stylesheets that resolve the same conflict
 * differently, and makes the emitted bytes irreproducible, which is also what content-hashed
 * asset caching is keyed on.
 *
 * Sorted by code unit rather than `localeCompare`, whose answer depends on the host's locale —
 * the exact class of machine-dependence this exists to remove.
 */
export const sortSources = (files: string[]) => files.sort()

const slashes = (path: string) => path.replaceAll('\\', '/')

/**
 * A folder's entry, joined as the walk joins it — onto the path it read, with `/` unless that path
 * ends in one already — and spelled as every path here is, with `/`.
 */
const entryPath = (directory: string, name: string) =>
  slashes(directory.endsWith('/') ? directory + name : `${directory}/${name}`)

interface WalkedDirectory {
  /** The folder it was listed in, when this walk read that one as well. */
  parent: string | undefined
  /** Whether it was listed as a symbolic link. */
  link: boolean
  /** The device and inode behind it, once known. */
  identity?: string
  /** Where it really is, once asked. */
  real?: string
  /** Whether it was read as empty, closing a loop. */
  cut?: boolean
}

const identify = (stats: { dev: number; ino: number }) => `${stats.dev}:${stats.ino}`

/**
 * One walk's `readdirSync` and `statSync`, which end the walk where a link leads back into it.
 *
 * The glob follows symbolic links — how a workspace package or a folder linked into `src` is read
 * at all — and a link to a folder the walk was inside took it round that folder again, and again:
 * once per lap until the system would resolve no deeper a chain of links, some thirty of them, with
 * every file returned once per lap — and with two such links on the way, the laps doubled each
 * time round, and the build hung at the glob with nothing to say why. Every folder the walk reads
 * is listed here, so a link whose folder is one the walk is already inside is read as empty, as
 * `find -L` reads it: all of it is being read already, by the path that reached it first. A link
 * that closes no loop is followed, and every path through it returned, as before.
 *
 * Only a link is asked, since only a link can close a loop, and by what the walk already learns of
 * it: listing a link, the walk stats it, which names the folder behind it by device and inode. The
 * folders above it are stat'd once each — mostly, just the one the walk began at — and a real path
 * is resolved only where two of those match, to tell apart inodes too large to be told apart.
 */
const stopAtCycles = () => {
  const directories = new Map<string, WalkedDirectory>()
  /** Every entry listed that is a symbolic link, by its path, and what the walk's stat of it found. */
  const links = new Map<string, string | undefined>()

  const identityOf = (directory: string): string => {
    const walked = directories.get(directory)!
    if (walked.identity === undefined) {
      try {
        walked.identity = (walked.link && links.get(directory)) || identify(statSync(directory))
      } catch {
        walked.identity = directory
      }
    }
    return walked.identity
  }

  const realDirectory = (directory: string): string => {
    const walked = directories.get(directory)!
    if (walked.real === undefined) {
      try {
        walked.real = slashes(realpathSync.native(directory))
      } catch {
        walked.real = directory
      }
    }
    return walked.real
  }

  const readdir = ((path: string, options?: { withFileTypes?: boolean }) => {
    const directory = slashes(String(path))
    // Its folder as the walk spelled it, which keeps its separator for a root.
    const cut = directory.lastIndexOf('/')
    const above = directory.slice(0, cut)
    const parent = directories.has(above)
      ? above
      : directories.has(directory.slice(0, cut + 1))
        ? directory.slice(0, cut + 1)
        : undefined
    const link = links.has(directory)
    directories.set(directory, { link, parent })

    if (link) {
      for (let ancestor = parent; ancestor !== undefined; ancestor = directories.get(ancestor)!.parent) {
        if (identityOf(ancestor) !== identityOf(directory)) continue
        if (realDirectory(ancestor) !== realDirectory(directory)) continue
        logger.debug('glob', `${directory} leads back into ${ancestor}, which is read already`)
        directories.get(directory)!.cut = true
        return []
      }
    }

    const entries = readdirSync(path, { withFileTypes: true })
    for (const entry of entries) if (entry.isSymbolicLink()) links.set(entryPath(String(path), entry.name), undefined)
    return options?.withFileTypes ? entries : entries.map((entry) => entry.name)
  }) as unknown as typeof readdirSync

  /** Every entry listed as a link that is one to a file. */
  const fileLinks = new Set<string>()

  const stat = ((path: string, options?: StatSyncOptions) => {
    const stats = statSync(path, options)
    const key = slashes(String(path))
    if (stats && links.has(key)) {
      links.set(key, identify(stats as Stats))
      if ((stats as Stats).isFile()) fileLinks.add(key)
    }
    return stats
  }) as typeof statSync

  /**
   * Where this walk began, and the folders and files it reached through a link, as it spelled them —
   * not a folder it read as empty, which is really one above it.
   */
  const linked = () => [
    ...[...directories].flatMap(([directory, walked]) =>
      (walked.parent === undefined || walked.link) && !walked.cut ? [directory] : [],
    ),
    ...fileLinks,
  ]

  return { linked, fs: { readdirSync: readdir, statSync: stat } }
}

/**
 * A task's patterns, by the folder each is walked from when it is alone.
 *
 * `fast-glob` walks every pattern inside `cwd` from `.` once any of them starts there, which saves
 * reading folders twice — and would make where a loop closes, and so what a pattern behind a link
 * matches, hang on its neighbours: `src/a/loop/**` matches through `src/a/loop` when walked from
 * there, and nothing once `*.css` beside it has the walk start at `.` and meet `src` first.
 */
const byOwnBase = (task: glob.Task, cwd: string | undefined) => {
  if (task.base !== '.' || task.positive.length < 2) return [task.positive]
  return [...byWalk(task.positive, cwd).values()]
}

export const nodeRuntime: Runtime = {
  cwd() {
    return process.cwd()
  },
  env(name: string) {
    return process.env[name]
  },
  path: {
    join,
    relative,
    dirname,
    extname,
    isAbsolute,
    sep,
    resolve,
    abs(cwd: string, str: string) {
      return isAbsolute(str) ? str : join(cwd, str)
    },
  },
  fs: {
    existsSync: fsExtra.existsSync,
    readFileSync(filePath: string) {
      return fsExtra.readFileSync(filePath, 'utf8')
    },
    glob(opts) {
      if (!opts.include) return []

      // One walk per folder a pattern starts from, each watched on its own and given the negatives
      // once — they come back in every task, `ignore` among them.
      const { cwd } = opts
      const walks: string[][] = []
      for (const task of glob.generateTasks(opts.include, { cwd, ignore: globIgnore(opts.exclude) })) {
        const negatives = task.negative.map((pattern) => `!${pattern}`)
        for (const patterns of byOwnBase(task, cwd)) {
          const walk = stopAtCycles()
          const found = glob.sync([...patterns, ...negatives], { absolute: true, cwd, fs: walk.fs })
          walks.push(found)
          // A pattern without a glob is looked up, not walked: what it found is all there is to tell,
          // and may be a link, or under one.
          opts.linked?.push(...walk.linked(), ...(task.dynamic ? [] : found))
        }
      }
      const files = sortSources(walks.length === 1 ? walks[0]! : walks.flat())
      // A path two walks both reach — `src/**` and `src/ui/**` — once, as `fast-glob` gives it; sorted
      // already, so a repeat sits beside its first.
      return walks.length > 1 ? files.filter((file, index) => index === 0 || file !== files[index - 1]) : files
    },
    writeFile: fsExtra.writeFile,
    writeFileSync: fsExtra.writeFileSync,
    readDirSync: fsExtra.readdirSync,
    isDirSync(path: string) {
      // `statSync` throws on a path that is not there, and every caller here would answer
      // that the same way.
      return fsExtra.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
    },
    rmDirSync: fsExtra.emptyDirSync,
    rmFileSync: fsExtra.removeSync,
    ensureDirSync(path: string) {
      return fsExtra.ensureDirSync(path)
    },
    watch(options) {
      const { include, exclude, cwd, poll } = options
      const coalesce = poll || process.platform === 'win32'

      const dirnames = globDirname(include)
      const workingDir = cwd || process.cwd()
      const isValidPath = sourceMatcher(include, exclude, workingDir)

      const watcher = chokidar.watch(dirnames, {
        usePolling: poll,
        cwd,
        ignored(path, stats) {
          const relativePath = relative(workingDir, path)
          return !!stats?.isFile() && !isValidPath(relativePath)
        },
        ignoreInitial: true,
        ignorePermissionErrors: true,
        awaitWriteFinish: coalesce ? { stabilityThreshold: 50, pollInterval: 10 } : false,
      })

      logger.debug('watch:file', `Watching [ ${dirnames.join(', ')} ]`)

      const onInterrupt = async () => {
        await watcher.close()
      }
      process.once('SIGINT', onInterrupt)

      // A watcher closed before the process is interrupted lets go of its listener: a watch that
      // re-arms otherwise left one behind each time, holding a watcher already closed.
      const close = watcher.close.bind(watcher)
      watcher.close = () => {
        process.off('SIGINT', onInterrupt)
        return close()
      }

      return watcher
    },
  },
}

process.setMaxListeners(Infinity)

process.on('unhandledRejection', (reason) => {
  logger.caughtError('process', 'Unhandled rejection', reason)
})

process.on('uncaughtException', (error) => {
  logger.caughtError('process', 'Uncaught exception', error)
})
