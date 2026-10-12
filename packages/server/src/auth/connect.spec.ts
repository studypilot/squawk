import {
   connectInfoResponseSchema,
   connectResponseSchema,
   meResponseSchema,
   type ConnectResponse
} from "@squawk/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { tokens } from "../db/schema"
import { createTestContext, type TestContext } from "../testing/test-context"
import { isTrustedOrigin, parseOriginPattern } from "./connect"
import { sha256Hex } from "./secrets"

const PATTERNS = ["https://*.netbird.studypilot.app", "http://localhost:*", "https://exact.test"]

describe("isTrustedOrigin", () => {
   it("matches a wildcard inside one host label", () => {
      expect(isTrustedOrigin("https://squawk-demo.netbird.studypilot.app", PATTERNS)).toBe(true)
      expect(isTrustedOrigin("https://netbird.studypilot.app", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://a.b.netbird.studypilot.app", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://evil-netbird.studypilot.app", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://demo.netbird.studypilot.app.evil.test", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://pr-12.preview.test", ["https://pr-*.preview.test"])).toBe(
         true
      )
      expect(isTrustedOrigin("https://qa-12.preview.test", ["https://pr-*.preview.test"])).toBe(
         false
      )
   })

   it("compares scheme and port exactly unless the port is a wildcard", () => {
      expect(isTrustedOrigin("http://demo.netbird.studypilot.app", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://demo.netbird.studypilot.app:8443", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("http://localhost:8099", PATTERNS)).toBe(true)
      expect(isTrustedOrigin("http://localhost", PATTERNS)).toBe(true)
      expect(isTrustedOrigin("https://localhost:8099", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://exact.test", PATTERNS)).toBe(true)
      expect(isTrustedOrigin("https://exact.test:444", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://exact.test", ["https://exact.test:443"])).toBe(true)
      expect(isTrustedOrigin("http://127.0.0.1:8099", ["http://127.0.0.1:*"])).toBe(true)
   })

   it("refuses anything that is not a plain origin", () => {
      expect(isTrustedOrigin("https://exact.test/", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://user@exact.test", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("not an origin", PATTERNS)).toBe(false)
      expect(isTrustedOrigin("https://exact.test", [])).toBe(false)
   })

   it("parses only scheme, host and optional port", () => {
      expect(parseOriginPattern("https://*.example.com")).toEqual({
         protocol: "https:",
         hostLabels: ["*", "example", "com"],
         port: ""
      })
      for (const pattern of ["*.example.com", "https://example.com/", "https://", "https://a..b"]) {
         expect(parseOriginPattern(pattern)).toBeNull()
      }
   })
})

let context: TestContext
let cookie: string

beforeAll(async () => {
   context = await createTestContext({ trustedOriginPatterns: ["https://*.preview.test"] })
   cookie = (await context.signIn("grace@example.com")).cookie
})

afterAll(() => context.close())

function info(origin: string, credentials: { cookie: string } | { bearer: string } | null) {
   return context.request("GET", `/api/auth/connect?origin=${encodeURIComponent(origin)}`, {
      credentials
   })
}

function connect(json: unknown, headers: Record<string, string> = {}) {
   return context.request("POST", "/api/auth/connect", {
      credentials: { cookie },
      headers: { Origin: "http://squawk.test", ...headers },
      json
   })
}

describe("popup login", () => {
   it("tells trusted from untrusted origins", async () => {
      const trusted = await info("https://pr-7.preview.test", { cookie })
      expect(trusted.status).toBe(200)
      expect(connectInfoResponseSchema.parse(await trusted.json())).toEqual({
         origin: "https://pr-7.preview.test",
         trusted: true
      })

      const untrusted = await info("https://elsewhere.test", { cookie })
      expect(await untrusted.json()).toEqual({ origin: "https://elsewhere.test", trusted: false })
   })

   it("issues a working login token named after the host", async () => {
      const response = await connect({ origin: "https://pr-7.preview.test" })
      expect(response.status).toBe(200)
      const body: ConnectResponse = connectResponseSchema.parse(await response.json())
      expect(body.token).toMatch(/^sqk_[A-Za-z0-9]{32}$/)
      expect(body.user).toMatchObject({ kind: "user", email: "grace@example.com" })

      const [stored] = await context.database
         .select()
         .from(tokens)
         .where(eq(tokens.hash, sha256Hex(body.token)))
      expect(stored).toMatchObject({ name: "Overlay on pr-7.preview.test", kind: "login" })
      const lifetimeDays = (stored!.expiresAt!.getTime() - Date.now()) / 86_400_000
      expect(Math.round(lifetimeDays)).toBe(30)

      const me = await context.request("GET", "/api/me", { credentials: { bearer: body.token } })
      expect(meResponseSchema.parse(await me.json())).toMatchObject({
         principal: { kind: "user", email: "grace@example.com" },
         token: { kind: "login", name: "Overlay on pr-7.preview.test", siteKey: null }
      })
   })

   it("uses the given label, cut to the token name limit", async () => {
      const response = await connect({ origin: "https://elsewhere.test", label: "x".repeat(150) })
      const { token } = connectResponseSchema.parse(await response.json())
      const [stored] = await context.database
         .select()
         .from(tokens)
         .where(eq(tokens.hash, sha256Hex(token)))
      expect(stored?.name).toBe("x".repeat(100))
   })

   it("requires a browser session", async () => {
      expect((await info("https://pr-7.preview.test", null)).status).toBe(401)
      const anonymous = await context.request("POST", "/api/auth/connect", {
         json: { origin: "https://pr-7.preview.test" }
      })
      expect(anonymous.status).toBe(401)

      const { user } = await context.signIn("grace@example.com")
      const agent = await context.createToken({ kind: "agent", createdBy: user })
      const login = await context.createToken({ kind: "login", createdBy: user })
      for (const { secret } of [agent, login]) {
         expect((await info("https://pr-7.preview.test", { bearer: secret })).status).toBe(403)
         const minted = await context.request("POST", "/api/auth/connect", {
            credentials: { bearer: secret },
            json: { origin: "https://pr-7.preview.test" }
         })
         expect(minted.status).toBe(403)
      }
   })

   it("validates the origin", async () => {
      for (const origin of [
         "",
         "pr-7.preview.test",
         "https://pr-7.preview.test/",
         "https://pr-7.preview.test/path",
         "javascript:alert(1)",
         `https://${"a".repeat(300)}.test`
      ]) {
         const answer = await info(origin, { cookie })
         expect(answer.status).toBe(400)
         expect(await answer.json()).toMatchObject({ error: { code: "validation" } })
         expect((await connect({ origin })).status).toBe(400)
      }
      expect(
         (await context.request("GET", "/api/auth/connect", { credentials: { cookie } })).status
      ).toBe(400)
   })

   it("refuses cookie writes from a foreign origin", async () => {
      const response = await connect(
         { origin: "https://pr-7.preview.test" },
         { Origin: "https://pr-7.preview.test" }
      )
      expect(response.status).toBe(403)
   })

   it("limits sign-ins per client address", async () => {
      const headers = { "X-Forwarded-For": "203.0.113.9" }
      for (let attempt = 0; attempt < 20; attempt += 1) {
         expect((await connect({ origin: "https://pr-7.preview.test" }, headers)).status).toBe(200)
      }
      const overLimit = await connect({ origin: "https://pr-7.preview.test" }, headers)
      expect(overLimit.status).toBe(429)
   })
})
