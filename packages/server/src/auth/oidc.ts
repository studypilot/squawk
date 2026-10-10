import { Hono } from "hono"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import * as client from "openid-client"
import type { OidcConfig } from "../config"
import type { AppEnv } from "../context"
import { describeError } from "../logger"
import { clearSessionCookie, isSecureOrigin, setSessionCookie } from "./session"
import { recordLogin } from "./users"

const OIDC_COOKIE_NAME = "squawk_oidc"
const OIDC_COOKIE_MAX_AGE_SECONDS = 10 * 60

interface PendingLogin {
   state: string
   codeVerifier: string
   returnTo: string
}

/** Browser login through the configured OpenID Connect issuer, under `/auth`. */
export function createOidcRoutes(): Hono<AppEnv> {
   const routes = new Hono<AppEnv>()
   let discovered: Promise<client.Configuration> | null = null

   /** Discovery runs on the first login and is retried after a failure. */
   function getConfiguration(oidc: OidcConfig): Promise<client.Configuration> {
      discovered ??= client
         .discovery(new URL(oidc.issuer), oidc.clientId, oidc.clientSecret)
         .catch(error => {
            discovered = null
            throw error
         })
      return discovered
   }

   routes.get("/login", async c => {
      const { config } = c.var.dependencies
      if (!config.oidc) {
         return c.text("Sign-in is not configured on this server (set the OIDC_* variables).", 503)
      }

      const pendingLogin: PendingLogin = {
         state: client.randomState(),
         codeVerifier: client.randomPKCECodeVerifier(),
         returnTo: safeReturnPath(c.req.query("returnTo"))
      }
      const parameters: Record<string, string> = {
         redirect_uri: `${config.publicUrl}/auth/callback`,
         scope: "openid email profile",
         state: pendingLogin.state,
         code_challenge: await client.calculatePKCECodeChallenge(pendingLogin.codeVerifier),
         code_challenge_method: "S256"
      }
      if (config.oidc.hostedDomain) parameters.hd = config.oidc.hostedDomain

      const configuration = await getConfiguration(config.oidc)
      await setSignedCookie(
         c,
         OIDC_COOKIE_NAME,
         JSON.stringify(pendingLogin),
         config.sessionSecret,
         {
            httpOnly: true,
            sameSite: "Lax",
            secure: isSecureOrigin(config),
            path: "/auth",
            maxAge: OIDC_COOKIE_MAX_AGE_SECONDS
         }
      )
      return c.redirect(client.buildAuthorizationUrl(configuration, parameters).href)
   })

   routes.get("/callback", async c => {
      const { config, database, logger } = c.var.dependencies
      if (!config.oidc) return c.text("Sign-in is not configured on this server.", 503)

      const cookieValue = await getSignedCookie(c, config.sessionSecret, OIDC_COOKIE_NAME)
      deleteCookie(c, OIDC_COOKIE_NAME, { path: "/auth", secure: isSecureOrigin(config) })
      const pendingLogin = cookieValue ? parsePendingLogin(cookieValue) : null
      if (!pendingLogin) return c.text("Sign-in expired. Please start again.", 400)

      let claims: client.IDToken | undefined
      try {
         const configuration = await getConfiguration(config.oidc)
         const callbackUrl = new URL(
            `${config.publicUrl}/auth/callback${new URL(c.req.url).search}`
         )
         const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
            pkceCodeVerifier: pendingLogin.codeVerifier,
            expectedState: pendingLogin.state,
            idTokenExpected: true
         })
         claims = tokens.claims()
      } catch (error) {
         logger.warn("oidc callback failed", describeError(error))
         return c.text("Sign-in failed. Please start again.", 400)
      }

      const rejection = checkClaims(claims, config.oidc)
      if (rejection || !claims) return c.text(rejection ?? "Sign-in failed.", 403)

      const user = await recordLogin(database, {
         email: String(claims.email),
         name: typeof claims.name === "string" ? claims.name : null,
         avatarUrl: typeof claims.picture === "string" ? claims.picture : null
      })
      await setSessionCookie(c, config, user)
      logger.info("user signed in", { userId: user.id })
      return c.redirect(pendingLogin.returnTo)
   })

   routes.post("/logout", c => {
      clearSessionCookie(c, c.var.dependencies.config)
      return c.body(null, 204)
   })

   return routes
}

/** Returns a reason to refuse the sign-in, or null when the account may use this server. */
export function checkClaims(claims: client.IDToken | undefined, oidc: OidcConfig): string | null {
   if (!claims) return "The identity provider returned no ID token."
   if (typeof claims.email !== "string") return "The identity provider returned no email address."
   if (claims.email_verified !== true) return "Your email address is not verified."

   const domain = claims.email.split("@").at(-1)?.toLowerCase() ?? ""
   if (!oidc.allowedEmailDomains.includes(domain)) {
      return `Accounts from ${domain} may not use this server.`
   }
   if (oidc.hostedDomain && claims.hd !== oidc.hostedDomain) {
      return `Sign in with your ${oidc.hostedDomain} account.`
   }
   return null
}

function parsePendingLogin(value: string): PendingLogin | null {
   try {
      const parsed = JSON.parse(value) as Partial<PendingLogin>
      if (typeof parsed.state !== "string" || typeof parsed.codeVerifier !== "string") return null
      return {
         state: parsed.state,
         codeVerifier: parsed.codeVerifier,
         returnTo: safeReturnPath(parsed.returnTo)
      }
   } catch {
      return null
   }
}

/** Only same-origin paths, so the login cannot be abused as an open redirect. */
export function safeReturnPath(value: string | undefined): string {
   if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
      return "/"
   return value
}
