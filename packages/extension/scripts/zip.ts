import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateRawSync } from "node:zlib"

/*
 * Packs `dist/` into `squawk-extension-<version>.zip` with a minimal ZIP writer (deflate, no
 * extra fields). Timestamps are fixed so the same build always produces the same archive.
 */

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const distDirectory = join(packageDirectory, "dist")
const { version } = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
   version: string
}
const archivePath = join(packageDirectory, `squawk-extension-${version}.zip`)

const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0

function listFiles(directory: string): string[] {
   return readdirSync(directory)
      .sort()
      .flatMap(name => {
         const path = join(directory, name)
         return statSync(path).isDirectory() ? listFiles(path) : [path]
      })
}

const localParts: Buffer[] = []
const centralParts: Buffer[] = []
let offset = 0

for (const path of listFiles(distDirectory)) {
   const name = Buffer.from(relative(distDirectory, path).split(sep).join("/"), "utf8")
   const content = readFileSync(path)
   const compressed = deflateRawSync(content, { level: 9 })
   const checksum = crc32(content)

   const local = Buffer.alloc(30)
   local.writeUInt32LE(0x04034b50, 0)
   local.writeUInt16LE(20, 4)
   local.writeUInt16LE(0x0800, 6)
   local.writeUInt16LE(8, 8)
   local.writeUInt16LE(DOS_TIME, 10)
   local.writeUInt16LE(DOS_DATE, 12)
   local.writeUInt32LE(checksum, 14)
   local.writeUInt32LE(compressed.length, 18)
   local.writeUInt32LE(content.length, 22)
   local.writeUInt16LE(name.length, 26)
   local.writeUInt16LE(0, 28)

   const central = Buffer.alloc(46)
   central.writeUInt32LE(0x02014b50, 0)
   central.writeUInt16LE((3 << 8) | 20, 4)
   central.writeUInt16LE(20, 6)
   central.writeUInt16LE(0x0800, 8)
   central.writeUInt16LE(8, 10)
   central.writeUInt16LE(DOS_TIME, 12)
   central.writeUInt16LE(DOS_DATE, 14)
   central.writeUInt32LE(checksum, 16)
   central.writeUInt32LE(compressed.length, 20)
   central.writeUInt32LE(content.length, 24)
   central.writeUInt16LE(name.length, 28)
   central.writeUInt32LE(UNIX_FILE_ATTRIBUTES, 38)
   central.writeUInt32LE(offset, 42)

   localParts.push(local, name, compressed)
   centralParts.push(central, name)
   offset += local.length + name.length + compressed.length
}

const centralDirectory = Buffer.concat(centralParts)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(centralParts.length / 2, 8)
end.writeUInt16LE(centralParts.length / 2, 10)
end.writeUInt32LE(centralDirectory.length, 12)
end.writeUInt32LE(offset, 16)

writeFileSync(archivePath, Buffer.concat([...localParts, centralDirectory, end]))
console.log(`Wrote ${relative(process.cwd(), archivePath)} (${centralParts.length / 2} files)`)
