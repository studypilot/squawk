import { randomBytes } from "node:crypto"
import {
   DEVICE_CODE_POLL_INTERVAL_SECONDS,
   DEVICE_CODE_TTL_SECONDS,
   LOGIN_TOKEN_TTL_DAYS,
   deviceDecisionInputSchema,
   devicePollInputSchema,
   deviceStartInputSchema,
   type DevicePollResponse,
   type DeviceStartResponse
} from "@squawk/shared"
import { getConnInfo } from "@hono/node-server/conninfo"
import { and, count, eq, gt, lt } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { toIsoString, toUserAuthor } from "../api/views"
import type { AppEnv } from "../context"
import type { Database } from "../db/index"
import { deviceCodes, users } from "../db/schema"
import { ApiError, notFound, parseInput } from "../http/errors"
import { readJsonBody } from "../http/json"
import { createRateLimiter } from "../http/rate-limit"
import { getSessionUser } from "./principal"
import { randomBase62, sha256Hex } from "./secrets"
import { insertToken } from "./tokens"

const userCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const DEVICE_STARTS_PER_ADDRESS_PER_MINUTE = 5
/** Unapproved, unexpired codes across all callers; keeps the table bounded under a flood. */
export const PENDING_DEVICE_CODES_MAX = 500
/** Tolerance for client timers that fire slightly early. */
const POLL_INTERVAL_SLACK_MS = 500

/** Device-code login for the overlay and the CLI, under `/api/auth/device`. */
export function createDeviceRoutes(): Hono<AppEnv> {
   const routes = new Hono<AppEnv>()
   const startLimiter = createRateLimiter(DEVICE_STARTS_PER_ADDRESS_PER_MINUTE, 60_000)

   routes.post("/", async c => {
      const { database, config } = c.var.dependencies
      const input = parseInput(deviceStartInputSchema, await readJsonBody(c))
      if (!startLimiter.tryConsume(clientAddress(c))) {
         throw new ApiError(429, "rate_limited", "Too many login attempts, try again in a minute")
      }

      const now = new Date()
      await database.delete(deviceCodes).where(lt(deviceCodes.expiresAt, now))
      const [pending] = await database
         .select({ total: count() })
         .from(deviceCodes)
         .where(and(eq(deviceCodes.status, "pending"), gt(deviceCodes.expiresAt, now)))
      if ((pending?.total ?? 0) >= PENDING_DEVICE_CODES_MAX) {
         throw new ApiError(429, "rate_limited", "Too many pending logins, try again later")
      }

      const deviceCode = randomBase62(32)
      const userCode = createUserCode()
      await database.insert(deviceCodes).values({
         deviceCodeHash: sha256Hex(deviceCode),
         userCode,
         kind: input.kind,
         label: input.label,
         expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000)
      })

      const response: DeviceStartResponse = {
         deviceCode,
         userCode,
         verificationUrl: `${config.publicUrl}/device?code=${userCode}`,
         expiresIn: DEVICE_CODE_TTL_SECONDS,
         interval: DEVICE_CODE_POLL_INTERVAL_SECONDS
      }
      return c.json(response)
   })

   routes.post("/token", async c => {
      const { database } = c.var.dependencies
      const input = parseInput(devicePollInputSchema, await readJsonBody(c))
      const now = new Date()
      const [row] = await database
         .select()
         .from(deviceCodes)
         .where(eq(deviceCodes.deviceCodeHash, sha256Hex(input.deviceCode)))
      if (!row || row.expiresAt <= now)
         return c.json({ status: "expired" } satisfies DevicePollResponse)

      const minimumGapMs = DEVICE_CODE_POLL_INTERVAL_SECONDS * 1000 - POLL_INTERVAL_SLACK_MS
      if (row.lastPolledAt && now.getTime() - row.lastPolledAt.getTime() < minimumGapMs) {
         throw new ApiError(429, "rate_limited", "Polling too fast, respect the interval")
      }
      await database
         .update(deviceCodes)
         .set({ lastPolledAt: now })
         .where(eq(deviceCodes.id, row.id))

      if (row.status === "pending")
         return c.json({ status: "pending" } satisfies DevicePollResponse)
      if (row.status === "denied") {
         await database.delete(deviceCodes).where(eq(deviceCodes.id, row.id))
         return c.json({ status: "denied" } satisfies DevicePollResponse)
      }
      return c.json(await issueLoginToken(database, row.id))
   })

   routes.get("/info", async c => {
      const { database } = c.var.dependencies
      await getSessionUser(c)
      const row = await findPendingCode(database, c.req.query("userCode") ?? "")
      return c.json({
         userCode: row.userCode,
         kind: row.kind,
         label: row.label,
         expiresAt: toIsoString(row.expiresAt)
      })
   })

   routes.post("/approve", async c => {
      const { database } = c.var.dependencies
      const user = await getSessionUser(c)
      const input = parseInput(deviceDecisionInputSchema, await readJsonBody(c))
      const row = await findPendingCode(database, input.userCode)
      await database
         .update(deviceCodes)
         .set({ status: "approved", userId: user.id })
         .where(and(eq(deviceCodes.id, row.id), eq(deviceCodes.status, "pending")))
      return c.body(null, 204)
   })

   routes.post("/deny", async c => {
      const { database } = c.var.dependencies
      await getSessionUser(c)
      const input = parseInput(deviceDecisionInputSchema, await readJsonBody(c))
      const row = await findPendingCode(database, input.userCode)
      await database
         .update(deviceCodes)
         .set({ status: "denied" })
         .where(and(eq(deviceCodes.id, row.id), eq(deviceCodes.status, "pending")))
      return c.body(null, 204)
   })

   return routes
}

/** The first `X-Forwarded-For` entry behind the reverse proxy, else the socket's peer address. */
function clientAddress(c: Context<AppEnv>): string {
   const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
   if (forwarded) return forwarded
   try {
      return getConnInfo(c).remote.address ?? "unknown"
   } catch {
      // No Node socket behind this request (tests call the app directly).
      return "unknown"
   }
}

/**
 * Deletes the approved code and creates the login token in one transaction, so a token is
 * issued exactly once even if two polls race.
 */
async function issueLoginToken(
   database: Database,
   deviceCodeId: string
): Promise<DevicePollResponse> {
   return database.transaction(async transaction => {
      const [claimed] = await transaction
         .delete(deviceCodes)
         .where(and(eq(deviceCodes.id, deviceCodeId), eq(deviceCodes.status, "approved")))
         .returning()
      if (!claimed?.userId) return { status: "expired" }

      const [user] = await transaction.select().from(users).where(eq(users.id, claimed.userId))
      if (!user) return { status: "expired" }

      const kindLabel = claimed.kind === "overlay" ? "Overlay" : "CLI"
      const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
      const { secret } = await insertToken(transaction, {
         name: `${kindLabel} ${claimed.label}`,
         kind: "login",
         siteId: null,
         createdBy: user,
         expiresAt
      })
      return {
         status: "approved",
         token: secret,
         expiresAt: expiresAt.toISOString(),
         principal: toUserAuthor(user)
      }
   })
}

async function findPendingCode(database: Database, rawUserCode: string) {
   const [row] = await database
      .select()
      .from(deviceCodes)
      .where(
         and(
            eq(deviceCodes.userCode, normalizeUserCode(rawUserCode)),
            eq(deviceCodes.status, "pending"),
            gt(deviceCodes.expiresAt, new Date())
         )
      )
   if (!row) throw notFound("This code is invalid or has expired")
   return row
}

/** Eight characters without look-alikes (no I, O, 0, 1), shown as `XXXX-XXXX`. */
function createUserCode(): string {
   const characters = [...randomBytes(8)].map(byte => userCodeAlphabet[byte % 32]).join("")
   return `${characters.slice(0, 4)}-${characters.slice(4)}`
}

/** Accepts codes typed in any case, with or without the dash. */
function normalizeUserCode(rawUserCode: string): string {
   const characters = rawUserCode.toUpperCase().replace(/[^A-Z0-9]/g, "")
   return `${characters.slice(0, 4)}-${characters.slice(4)}`
}
