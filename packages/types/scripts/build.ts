// @ts-nocheck
import fs from 'fs'
import path from 'path'

const toExt = (ext: string) => (file: string) => file.replace(/\.ts$/, ext)
const toDts = toExt('.d.ts')

export const main = (outDir = path.join(__dirname, '..', 'dist')) => {
  const inputPath = path.join(__dirname, '..', 'src')
  const files = fs.readdirSync(inputPath)

  const getOrCreateDir = (dir: string) => {
    try {
      fs.mkdirSync(dir)
    } catch {
      // ignore
    }
  }

  files.forEach((file) => {
    const destFile = path.join(outDir, file.endsWith('.d.ts') ? file : toDts(file))
    getOrCreateDir(outDir)
    const content = fs.readFileSync(path.join(inputPath, file as string))
    fs.writeFileSync(destFile, content)
  })
}

// Run as the package's build; imported, as `watch.ts` and a test do, it builds when it is told.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
