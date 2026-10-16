import nodePath from 'node:path'

/**
 * One spelling for a path used as a map key against paths from somewhere else.
 *
 * The fold reports dependencies as ts-morph sees them and Vite reports a changed file as its
 * watcher saw it. On Windows those differ by separator, and can differ by the case of the
 * drive letter alone — chokidar reports what the OS handed it, `path.resolve` preserves
 * whatever the cwd had. Either would make every lookup miss and restore the exact staleness
 * the lookup exists to fix, silently, since a miss is indistinguishable from a module that
 * folded nothing. Only the drive letter is case-folded: the rest of the path is compared as
 * written, because elsewhere the filesystem may well be case-sensitive.
 *
 * `path` is the platform's, and is a parameter so the Windows spelling can be checked anywhere.
 */
export const normalizeFsPath = (file: string, path: Pick<typeof nodePath, 'resolve'> = nodePath) =>
  path
    .resolve(file)
    .replaceAll('\\', '/')
    .replace(/^[a-z]:\//, (drive) => drive.toUpperCase())

/**
 * The key a file is held under in the session's set of extracted ones, and looked up by.
 *
 * The set is filled from the inventory, which fast-glob spells `C:/app/src/a.tsx` on Windows,
 * and asked about a file Vite's watcher reported as `C:\app\src\a.tsx`. The check missed every
 * edit there, and a file only the extractor reads — a JSON theme, a module nothing imports —
 * never repainted the stylesheet. Elsewhere both are already spelled one way, and the path is
 * its own key.
 */
export const extractedFileKeyFor = (path: Pick<typeof nodePath, 'resolve' | 'sep'>) =>
  path.sep === '\\' ? (file: string) => normalizeFsPath(file, path) : (file: string) => file

export const extractedFileKey = extractedFileKeyFor(nodePath)
