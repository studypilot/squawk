import { createHash, randomBytes } from "node:crypto"
import { TOKEN_PREFIX, TOKEN_RANDOM_LENGTH } from "@squawk/shared"

const base62Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/** Uniformly distributed base62 string; bytes above the largest multiple of 62 are skipped. */
export function randomBase62(length: number): string {
   const largestUnbiasedByte = 62 * 4
   let result = ""
   while (result.length < length) {
      for (const byte of randomBytes(length * 2)) {
         if (byte >= largestUnbiasedByte) continue
         result += base62Alphabet[byte % 62]
         if (result.length === length) break
      }
   }
   return result
}

export function createTokenSecret(): string {
   return `${TOKEN_PREFIX}${randomBase62(TOKEN_RANDOM_LENGTH)}`
}

export function sha256Hex(value: string): string {
   return createHash("sha256").update(value).digest("hex")
}
