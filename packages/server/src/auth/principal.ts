import { eq } from "drizzle-orm"
import type { Context } from "hono"
import type { AppEnv } from "../context"
import { sites, tokens, users, type SquawkRow, type TokenRow, type UserRow } from "../db/schema"
import { ApiError, forbidden, notFound } from "../http/errors"
import { sha256Hex } from "./secrets"
import { readSessionUserId } from "./session"
import { ensureUser, findUserById } from "./users"

export type TokenWithSite = TokenRow & { siteKey: string | null }

export type Principal =
   | {
        kind: "user"
        user: UserRow
        /** The login token the request used; null for the session cookie or the dev user. */
        viaToken: TokenWithSite | null
        siteRestriction: string | null
     }
   | { kind: "agent"; token: TokenWithSite; siteRestriction: string | null }

const LAST_USED_UPDATE_INTERVAL_MS = 60_000
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Resolves who is calling, or throws 401. A bearer token wins; otherwise the session cookie,
 * otherwise the development user if configured. Cookie-style credentials are checked for CSRF.
 */
export async function getPrincipal(c: Context<AppEnv>): Promise<Principal> {
   const cached = c.get("principal")
   if (cached) return cached
   const principal = await resolvePrincipal(c)
   c.set("principal", principal)
   return principal
}

/** Humans only: the session cookie, the dev user or a login token. Agent tokens get 403. */
export async function getUserPrincipal(
   c: Context<AppEnv>
): Promise<Extract<Principal, { kind: "user" }>> {
   const principal = await getPrincipal(c)
   if (principal.kind !== "user") throw forbidden("Agent tokens cannot manage tokens")
   return principal
}

/**
 * A signed-in browser session (or the dev user), as required for approving device logins and
 * for the popup login. Tokens of either kind get 403.
 */
export async function getSessionUser(c: Context<AppEnv>): Promise<UserRow> {
   const principal = await getPrincipal(c)
   if (principal.kind !== "user" || principal.viaToken) {
      throw forbidden("Do this from the browser while signed in, not with a token")
   }
   return principal.user
}

/** Site-restricted tokens see their own site only; everything else looks like it does not exist. */
export function assertSiteAccess(principal: Principal, siteKey: string): void {
   if (principal.siteRestriction !== null && principal.siteRestriction !== siteKey) {
      throw notFound("Site not found")
   }
}

/** True for the caller's own drafts. Drafts belong to the user, whichever client wrote them. */
export function isOwnDraft(
   principal: Principal,
   squawk: Pick<SquawkRow, "status" | "authorUserId">
): boolean {
   return (
      squawk.status === "draft" &&
      principal.kind === "user" &&
      squawk.authorUserId === principal.user.id
   )
}

/** Drafts exist only for their author; everyone else gets a 404 as if they did not exist. */
export function assertSquawkVisible(
   principal: Principal,
   squawk: Pick<SquawkRow, "status" | "authorUserId">
): void {
   if (squawk.status === "draft" && !isOwnDraft(principal, squawk)) {
      throw notFound("Squawk not found")
   }
}

/**
 * Column values for rows written by this principal. Login tokens write as their human; a CLI
 * login token also records itself, which marks the row as written by the user's agent.
 */
export function authorColumns(principal: Principal): {
   authorUserId: string | null
   authorTokenId: string | null
} {
   if (principal.kind === "agent") return { authorUserId: null, authorTokenId: principal.token.id }
   const agentTokenId = principal.viaToken?.client === "cli" ? principal.viaToken.id : null
   return { authorUserId: principal.user.id, authorTokenId: agentTokenId }
}

async function resolvePrincipal(c: Context<AppEnv>): Promise<Principal> {
   const { config, database } = c.var.dependencies

   const authorization = c.req.header("authorization")
   if (authorization) return resolveBearer(c, authorization)

   const sessionUserId = await readSessionUserId(c, config)
   const sessionUser = sessionUserId ? await findUserById(database, sessionUserId) : null
   if (sessionUser) {
      assertCsrfSafe(c)
      return { kind: "user", user: sessionUser, viaToken: null, siteRestriction: null }
   }

   if (config.devUserEmail) {
      assertCsrfSafe(c)
      const user = await ensureUser(database, config.devUserEmail)
      return { kind: "user", user, viaToken: null, siteRestriction: null }
   }

   throw new ApiError(401, "unauthorized", "Sign in or send a bearer token")
}

async function resolveBearer(c: Context<AppEnv>, authorization: string): Promise<Principal> {
   const { database } = c.var.dependencies
   const match = /^Bearer\s+(\S+)$/i.exec(authorization)
   if (!match?.[1]) {
      throw new ApiError(401, "unauthorized", "Authorization header must be `Bearer <token>`")
   }

   const [row] = await database
      .select({ token: tokens, siteKey: sites.key, user: users })
      .from(tokens)
      .innerJoin(users, eq(users.id, tokens.createdByUserId))
      .leftJoin(sites, eq(sites.id, tokens.siteId))
      .where(eq(tokens.hash, sha256Hex(match[1])))

   const now = new Date()
   const isUsable =
      row && !row.token.revokedAt && (!row.token.expiresAt || row.token.expiresAt > now)
   if (!row || !isUsable) {
      throw new ApiError(401, "unauthorized", "Token is invalid, revoked or expired")
   }

   const lastUsedAt = row.token.lastUsedAt
   if (!lastUsedAt || now.getTime() - lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
      await database.update(tokens).set({ lastUsedAt: now }).where(eq(tokens.id, row.token.id))
   }

   const token: TokenWithSite = { ...row.token, lastUsedAt: now, siteKey: row.siteKey }
   if (token.kind === "login") {
      return { kind: "user", user: row.user, viaToken: token, siteRestriction: token.siteKey }
   }
   return { kind: "agent", token, siteRestriction: token.siteKey }
}

/**
 * Cookie-authenticated writes must come from the server's own origin: browsers send `Origin` on
 * every cross-origin request (forms included), so a foreign one is refused outright. The body
 * must also be JSON (or the multipart squawk upload), which plain HTML forms cannot send and
 * cross-origin scripts can only send after a CORS preflight that `/api` never grants with
 * credentials. A DELETE carries no body and always needs that preflight, so only the origin rule
 * applies to it.
 */
function assertCsrfSafe(c: Context<AppEnv>): void {
   const method = c.req.method
   if (safeMethods.has(method)) return

   const origin = c.req.header("origin")
   const ownOrigin = new URL(c.var.dependencies.config.publicUrl).origin
   if (origin !== undefined && origin !== ownOrigin) {
      throw forbidden("Cookie-authenticated writes must come from the inbox origin")
   }
   if (method === "DELETE") return

   const contentType = (c.req.header("content-type") ?? "").toLowerCase()
   if (contentType.startsWith("application/json")) return
   const isSquawkUpload = method === "POST" && c.req.path === "/api/squawks"
   if (isSquawkUpload && contentType.startsWith("multipart/form-data")) return

   throw forbidden("Cookie-authenticated writes must send Content-Type: application/json")
}
