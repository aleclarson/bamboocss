import { posix } from 'node:path'
import picomatch from 'picomatch'

export function globDirname(globs: string[]) {
  const rootDirs = new Set<string>()

  for (const glob of globs) {
    const scan = picomatch.scan(glob, { tokens: true })
    if (!scan.isGlob) {
      rootDirs.add(glob)
      continue
    }
    const nonGlobTokens = scan.tokens?.filter((token: any) => !token.isPrefix && !token.isGlob)
    // A pattern with no folder before its first glob — `**/*.tsx` — is walked from `.`, beside
    // whatever folders the others name, not only when none of them names one. Joined as POSIX on
    // every platform, since a glob is POSIX syntax: on Windows `join` spelled the folder with `\`
    // and read the escape in `path/\*\*/subdir` as a separator.
    rootDirs.add(nonGlobTokens?.length ? posix.join(...nonGlobTokens.map((token: any) => token.value)) : '.')
  }

  if (rootDirs.size === 0) {
    return ['.']
  }

  return Array.from(rootDirs)
}
