import { posix, win32 } from 'node:path'
import { describe, expect, test } from 'vitest'
import { extractedFileKeyFor, normalizeFsPath } from '../src/fs-path'

/**
 * Windows spells one file several ways — by separator, and by the case of the drive letter — and
 * the watcher, the inventory and Vite's module ids each use whichever they were handed. Checked
 * against `path.win32`, which is what the platform's `path` is there, so the spellings that meet
 * on Windows can be checked on any machine.
 */
describe('a file', () => {
  const spellings = [
    'C:\\app\\src\\theme.json',
    'c:\\app\\src\\theme.json',
    'C:/app/src/theme.json',
    'c:/app/src/../src/theme.json',
  ]

  test('is one key on Windows, however it is spelled', () => {
    expect(new Set(spellings.map((file) => normalizeFsPath(file, win32)))).toEqual(new Set(['C:/app/src/theme.json']))
    // The watcher's spelling and the inventory's meet in the set of extracted files.
    expect(new Set(spellings.map(extractedFileKeyFor(win32)))).toEqual(new Set(['C:/app/src/theme.json']))
  })

  // Spelled one way already, by the inventory and the watcher alike, so it is its own key.
  test('is its own key elsewhere', () => {
    expect(extractedFileKeyFor(posix)('/app/src/theme.json')).toBe('/app/src/theme.json')
  })
})
