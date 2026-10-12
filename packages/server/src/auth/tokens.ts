import { LOGIN_TOKEN_TTL_DAYS, TOKEN_DISPLAY_PREFIX_LENGTH } from "@squawk/shared"
import type { Database } from "../db/index"
import { tokens, type TokenRow, type UserRow } from "../db/schema"
import { createTokenSecret, sha256Hex } from "./secrets"

interface NewToken {
   name: string
   kind: TokenRow["kind"]
   /** Which client a login token was issued to; null for agent tokens. */
   client?: TokenRow["client"]
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
         client: newToken.client ?? null,
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

/**
 * A login token for an overlay or CLI: acts as the user, all sites, `LOGIN_TOKEN_TTL_DAYS` long.
 * Writes through a `cli` token are shown as the user's agent rather than the user.
 */
export async function insertLoginToken(
   database: Pick<Database, "insert">,
   user: UserRow,
   name: string,
   client: NonNullable<TokenRow["client"]>
): Promise<{ secret: string; expiresAt: Date }> {
   const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
   const { secret } = await insertToken(database, {
      name,
      kind: "login",
      client,
      siteId: null,
      createdBy: user,
      expiresAt
   })
   return { secret, expiresAt }
}
