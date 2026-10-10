import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { sign, verify } from "hono/jwt"
import type { Config } from "../config"
import { isUuid } from "../uuid"

export const SESSION_COOKIE_NAME = "squawk_session"
const SESSION_TTL_SECONDS = 12 * 60 * 60

export function isSecureOrigin(config: Config): boolean {
   return config.publicUrl.startsWith("https://")
}

/** Signs the stateless session: an HS256 JWT with the user id and email, valid for 12 hours. */
export async function createSessionToken(
   config: Config,
   user: { id: string; email: string }
): Promise<string> {
   const issuedAt = Math.floor(Date.now() / 1000)
   return sign(
      { sub: user.id, email: user.email, iat: issuedAt, exp: issuedAt + SESSION_TTL_SECONDS },
      config.sessionSecret,
      "HS256"
   )
}

export async function setSessionCookie(
   c: Context,
   config: Config,
   user: { id: string; email: string }
): Promise<void> {
   setCookie(c, SESSION_COOKIE_NAME, await createSessionToken(config, user), {
      httpOnly: true,
      sameSite: "Lax",
      secure: isSecureOrigin(config),
      path: "/",
      maxAge: SESSION_TTL_SECONDS
   })
}

export function clearSessionCookie(c: Context, config: Config): void {
   deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: isSecureOrigin(config) })
}

/** Returns the user id of a valid session cookie, or null for a missing, forged or expired one. */
export async function readSessionUserId(c: Context, config: Config): Promise<string | null> {
   const token = getCookie(c, SESSION_COOKIE_NAME)
   if (!token) return null
   try {
      const payload = await verify(token, config.sessionSecret, "HS256")
      return typeof payload.sub === "string" && isUuid(payload.sub) ? payload.sub : null
   } catch {
      return null
   }
}
