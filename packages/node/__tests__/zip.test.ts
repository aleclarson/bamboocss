import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { createZip } from '../src/zip'

/** The entries an archive holds, read the way an unzip reads them: from its central directory. */
const read = (archive: Buffer) => {
  const end = archive.length - 22
  expect(archive.readUInt32LE(end), 'end of central directory').toBe(0x06054b50)
  const count = archive.readUInt16LE(end + 10)
  let at = archive.readUInt32LE(end + 16)
  const entries: Record<string, string> = {}
  for (let index = 0; index < count; index++) {
    expect(archive.readUInt32LE(at), 'central directory header').toBe(0x02014b50)
    const size = archive.readUInt32LE(at + 20)
    const checksum = archive.readUInt32LE(at + 16)
    const nameLength = archive.readUInt16LE(at + 28)
    const local = archive.readUInt32LE(at + 42)
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength)

    expect(archive.readUInt32LE(local), 'local header').toBe(0x04034b50)
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
    const data = inflateRawSync(archive.subarray(start, start + size))
    expect(crc32(data), name).toBe(checksum)
    entries[name] = data.toString('utf8')
    at += 46 + nameLength
  }
  return entries
}

describe('createZip', () => {
  test('holds each file under its name, deflated, with its checksum', () => {
    const files = {
      'debug/config.json': JSON.stringify({ outdir: 'styled-system' }),
      'debug/src__app.css': '.c_red { color: red }\n'.repeat(50),
      'debug/ünïcödé.json': '{}',
    }
    const archive = createZip(Object.entries(files).map(([name, data]) => ({ name, data })))

    expect(read(archive)).toEqual(files)
    // Deflated: the repeated rule is far smaller than as written.
    expect(archive.length).toBeLessThan(files['debug/src__app.css'].length)
  })

  test('is an archive with nothing in it, for nothing', () => {
    expect(read(createZip([]))).toEqual({})
  })

  // Without ZIP64 a zip records no more, and would be written wrong past it rather than failing.
  test('refuses more files than a zip records', () => {
    expect(() => createZip(Array.from({ length: 0x10000 }, (_, index) => ({ name: `${index}`, data: '' })))).toThrow(
      /at most 65535 files/,
    )
  })

  // Its years start at 1980: a clock before it is held to that, not written as a negative year.
  test('dates a file no earlier than a zip can', () => {
    const archive = createZip([{ name: 'a', data: 'a' }], new Date(1970, 0, 1))
    expect(archive.readUInt16LE(12), '1980-01-01').toBe((1 << 5) | 1)
  })
})
