import { TOKEN_DISPLAY_PREFIX_LENGTH } from "@squawk/shared"
import type { Database } from "../db/index"
import { tokens, type TokenRow, type UserRow } from "../db/schema"
import { createTokenSecret, sha256Hex } from "./secrets"

interface NewToken {
   name: string
   kind: TokenRow["kind"]
   siteId: string | null
   createdBy: UserRow
   expiresAt: Date | null
}

/** Stores a new token by hash and returns the row plus the one-time secret. */
export async function insertToken(
   database: Pick<Database, "insert">,
   newToken: NewToken
): Promise<{ token: TokenRow; secret: string }> {
   const secret = createTokenSecret()
   const [token] = await database
      .insert(tokens)
      .values({
         name: newToken.name,
         kind: newToken.kind,
         prefix: secret.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
         hash: sha256Hex(secret),
         siteId: newToken.siteId,
         createdByUserId: newToken.createdBy.id,
         expiresAt: newToken.expiresAt
      })
      .returning()
   if (!token) throw new Error("Token insert returned no row")
   return { token, secret }
}
