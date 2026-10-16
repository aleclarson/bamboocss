import { crc32, deflateRawSync } from 'node:zlib'

/** A file to put in an archive: its path inside it, and what it holds. */
export interface ZipEntry {
  name: string
  data: Buffer | string
}

/**
 * The time as an MS-DOS date and time, which is how a zip records when a file was written. Its
 * years run from 1980 to 2107, and a clock outside them is held to the nearest.
 */
const dosTime = (when: Date) => {
  const date = new Date(
    Math.min(Math.max(when.getTime(), new Date(1980, 0, 1).getTime()), new Date(2107, 11, 31).getTime()),
  )
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** What a zip without ZIP64 can record: 65,535 files, and no file nor archive past 4 GB. */
const MAX_ENTRIES = 0xffff
const MAX_SIZE = 0xffffffff

/**
 * A zip archive of `entries`, each deflated.
 *
 * Written here rather than by a dependency because `bamboo debug --zip` is all that needs one,
 * and the format a bug report attaches is small: a local header and the deflated data for each
 * file, the central directory naming them, and its end record. No ZIP64, so an archive is limited
 * to 4 GB and 65,535 files, which a debug dump never nears. Names are UTF-8, as flag bit 11 says.
 */
export const createZip = (entries: ZipEntry[], modified = new Date()): Buffer => {
  if (entries.length > MAX_ENTRIES) {
    throw new RangeError(`A zip holds at most ${MAX_ENTRIES} files, and this one would hold ${entries.length}.`)
  }
  const { time, date } = dosTime(modified)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data
    const deflated = deflateRawSync(data)
    const checksum = crc32(data)
    if (data.length > MAX_SIZE || offset + 30 + name.length + deflated.length > MAX_SIZE) {
      throw new RangeError(`A zip holds at most 4 GB, and \`${entry.name}\` takes this one past it.`)
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + deflated.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}
