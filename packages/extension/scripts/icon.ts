import { crc32, deflateSync } from "node:zlib"

/*
 * Draws the extension icon (an orange circle with a white "S") and encodes it as a PNG, so the
 * repository needs no binary assets. Every pixel is supersampled for smooth edges.
 */

const BACKGROUND = { red: 232, green: 89, blue: 12 }
const SUPERSAMPLING = 4
const STROKE_HALF_WIDTH = 0.085

type Point = readonly [number, number]

const letterPath: Point[] = [
   ...ellipseArc(0, -0.25, 0.3, 0.25, -30, -270),
   ...ellipseArc(0, 0.25, 0.3, 0.25, -90, 150)
]

function ellipseArc(
   centerX: number,
   centerY: number,
   radiusX: number,
   radiusY: number,
   fromDegrees: number,
   toDegrees: number
): Point[] {
   const steps = 48
   const points: Point[] = []
   for (let step = 0; step <= steps; step++) {
      const radians = ((fromDegrees + ((toDegrees - fromDegrees) * step) / steps) * Math.PI) / 180
      points.push([centerX + radiusX * Math.cos(radians), centerY + radiusY * Math.sin(radians)])
   }
   return points
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
   const segmentX = end[0] - start[0]
   const segmentY = end[1] - start[1]
   const lengthSquared = segmentX * segmentX + segmentY * segmentY
   const projection =
      lengthSquared === 0
         ? 0
         : ((point[0] - start[0]) * segmentX + (point[1] - start[1]) * segmentY) / lengthSquared
   const clamped = Math.min(1, Math.max(0, projection))
   return Math.hypot(
      point[0] - start[0] - clamped * segmentX,
      point[1] - start[1] - clamped * segmentY
   )
}

function isOnLetter(point: Point): boolean {
   for (let index = 1; index < letterPath.length; index++) {
      const start = letterPath[index - 1]
      const end = letterPath[index]
      if (start && end && distanceToSegment(point, start, end) <= STROKE_HALF_WIDTH) return true
   }
   return false
}

function renderPixels(size: number): Uint8Array {
   const pixels = new Uint8Array(size * size * 4)
   const samplesPerPixel = SUPERSAMPLING * SUPERSAMPLING
   for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
         let circleSamples = 0
         let letterSamples = 0
         for (let sampleRow = 0; sampleRow < SUPERSAMPLING; sampleRow++) {
            for (let sampleColumn = 0; sampleColumn < SUPERSAMPLING; sampleColumn++) {
               const x = ((column + (sampleColumn + 0.5) / SUPERSAMPLING) / size) * 2 - 1
               const y = ((row + (sampleRow + 0.5) / SUPERSAMPLING) / size) * 2 - 1
               if (x * x + y * y > 1) continue
               circleSamples++
               if (isOnLetter([x, y])) letterSamples++
            }
         }
         const offset = (row * size + column) * 4
         const letterShare = circleSamples === 0 ? 0 : letterSamples / circleSamples
         pixels[offset] = mix(BACKGROUND.red, 255, letterShare)
         pixels[offset + 1] = mix(BACKGROUND.green, 255, letterShare)
         pixels[offset + 2] = mix(BACKGROUND.blue, 255, letterShare)
         pixels[offset + 3] = Math.round((circleSamples / samplesPerPixel) * 255)
      }
   }
   return pixels
}

function mix(from: number, to: number, share: number): number {
   return Math.round(from + (to - from) * share)
}

function pngChunk(type: string, data: Uint8Array): Buffer {
   const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data])
   const length = Buffer.alloc(4)
   length.writeUInt32BE(data.length)
   const checksum = Buffer.alloc(4)
   checksum.writeUInt32BE(crc32(typeAndData))
   return Buffer.concat([length, typeAndData, checksum])
}

export function renderIconPng(size: number): Buffer {
   const pixels = renderPixels(size)
   const rowLength = size * 4
   const scanlines = Buffer.alloc((rowLength + 1) * size)
   for (let row = 0; row < size; row++) {
      scanlines[row * (rowLength + 1)] = 0
      scanlines.set(
         pixels.subarray(row * rowLength, (row + 1) * rowLength),
         row * (rowLength + 1) + 1
      )
   }
   const header = Buffer.alloc(13)
   header.writeUInt32BE(size, 0)
   header.writeUInt32BE(size, 4)
   header[8] = 8
   header[9] = 6
   return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(scanlines)),
      pngChunk("IEND", new Uint8Array(0))
   ])
}
