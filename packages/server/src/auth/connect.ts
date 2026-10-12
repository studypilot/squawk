import {
   LIMITS,
   connectInfoQuerySchema,
   connectInputSchema,
   type ConnectInfoResponse,
   type ConnectResponse
} from "@squawk/shared"
import { Hono } from "hono"
import { toUserAuthor } from "../api/views"
import type { AppEnv } from "../context"
import { ApiError, parseInput } from "../http/errors"
import { readJsonBody } from "../http/json"
import { clientAddress, createRateLimiter } from "../http/rate-limit"
import { getSessionUser } from "./principal"
import { insertLoginToken } from "./tokens"

const CONNECTS_PER_ADDRESS_PER_MINUTE = 20

/**
 * Popup login for the overlay, under `/api/auth/connect`. The overlay opens `/connect` on this
 * server; that page uses the browser session to ask whether the page origin is trusted and then
 * issues a login token for it, which it posts back to the overlay window.
 */
export function createConnectRoutes(): Hono<AppEnv> {
   const routes = new Hono<AppEnv>()
   const connectLimiter = createRateLimiter(CONNECTS_PER_ADDRESS_PER_MINUTE, 60_000)

   routes.get("/", async c => {
      const { config } = c.var.dependencies
      await getSessionUser(c)
      const { origin } = parseInput(connectInfoQuerySchema, { origin: c.req.query("origin") })
      const response: ConnectInfoResponse = {
         origin,
         trusted: isTrustedOrigin(origin, config.trustedOriginPatterns)
      }
      return c.json(response)
   })

   routes.post("/", async c => {
      const { database } = c.var.dependencies
      const user = await getSessionUser(c)
      const input = parseInput(connectInputSchema, await readJsonBody(c))
      if (!connectLimiter.tryConsume(clientAddress(c))) {
         throw new ApiError(429, "rate_limited", "Too many sign-ins, try again in a minute")
      }

      const label = input.label || `Overlay on ${new URL(input.origin).hostname}`
      const { secret } = await insertLoginToken(
         database,
         user,
         label.slice(0, LIMITS.tokenNameMaxLength),
         "overlay"
      )
      const response: ConnectResponse = { token: secret, user: toUserAuthor(user) }
      return c.json(response)
   })

   return routes
}

interface OriginPattern {
   protocol: string
   hostLabels: string[]
   /** Empty for the scheme's default port, `*` for any port. */
   port: string
}

const originPatternExpression = /^(https?):\/\/([a-z0-9*.-]+)(?::(\*|\d{1,5}))?$/
const defaultPorts: Record<string, string> = { http: "80", https: "443" }

/**
 * Parses `scheme://host[:port]`, where `*` stands for part of a host label or for the port.
 * Returns null for anything else, e.g. a missing scheme or a path.
 */
export function parseOriginPattern(pattern: string): OriginPattern | null {
   const match = originPatternExpression.exec(pattern.trim().toLowerCase())
   if (!match?.[1] || !match[2]) return null
   const hostLabels = match[2].split(".")
   if (hostLabels.some(label => label === "")) return null
   const port = match[3] ?? ""
   return {
      protocol: `${match[1]}:`,
      hostLabels,
      port: port === defaultPorts[match[1]] ? "" : port
   }
}

/**
 * True when the origin matches one of the patterns: same scheme, same number of host labels,
 * each label equal or matched by its wildcard (`*` covers one or more characters inside a single
 * label, never a dot), and the same port unless the pattern's port is `*`.
 */
export function isTrustedOrigin(origin: string, patterns: readonly string[]): boolean {
   let url: URL
   try {
      url = new URL(origin)
   } catch {
      return false
   }
   if (url.origin !== origin) return false
   const hostLabels = url.hostname.split(".")

   return patterns.some(rawPattern => {
      const pattern = parseOriginPattern(rawPattern)
      if (!pattern || pattern.protocol !== url.protocol) return false
      if (pattern.port !== "*" && pattern.port !== url.port) return false
      if (pattern.hostLabels.length !== hostLabels.length) return false
      return pattern.hostLabels.every((label, index) => labelMatches(label, hostLabels[index]))
   })
}

/** Pattern labels only hold `[a-z0-9-*]`, so the pieces between wildcards need no escaping. */
function labelMatches(patternLabel: string, label: string | undefined): boolean {
   if (label === undefined) return false
   if (!patternLabel.includes("*")) return patternLabel === label
   const expression = new RegExp(`^${patternLabel.split("*").join("[a-z0-9-]+")}$`)
   return expression.test(label)
}
