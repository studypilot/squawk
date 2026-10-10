import { errorResponseSchema, listSitesResponseSchema, meResponseSchema } from "@squawk/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { tokens, type UserRow } from "../db/schema"
import {
   createTestContext,
   screenshotMetadata,
   squawkForm,
   tinyPng,
   type TestContext
} from "../testing/test-context"

let context: TestContext
let user: UserRow
let cookie: string

beforeAll(async () => {
   context = await createTestContext()
   ;({ user, cookie } = await context.signIn("linus@example.com"))
})

afterAll(() => context.close())

describe("bearer tokens", () => {
   it("authenticates agent tokens as agents and records last use", async () => {
      const { token, secret } = await context.createToken({
         kind: "agent",
         createdBy: user,
         name: "Claude"
      })
      const me = await context.request("GET", "/api/me", { credentials: { bearer: secret } })
      expect(me.status).toBe(200)
      expect(meResponseSchema.parse(await me.json())).toEqual({
         principal: { kind: "agent", id: token.id, name: "Claude" },
         token: { id: token.id, name: "Claude", kind: "agent", siteKey: null }
      })

      const [stored] = await context.database.select().from(tokens).where(eq(tokens.id, token.id))
      expect(stored?.lastUsedAt).not.toBeNull()
   })

   it("attributes writes of agent tokens to the agent", async () => {
      const { secret } = await context.createToken({ kind: "agent", createdBy: user, name: "Bot" })
      const response = await context.request("POST", "/api/squawks", {
         credentials: { bearer: secret },
         body: squawkForm({ siteKey: "agent-writes", page: "/", body: "from a bot" })
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ author: { kind: "agent", name: "Bot" } })
   })

   it("rejects unknown, revoked and expired tokens", async () => {
      const unknown = await context.request("GET", "/api/me", {
         credentials: { bearer: "sqk_doesnotexist" }
      })
      expect(unknown.status).toBe(401)
      expect(errorResponseSchema.parse(await unknown.json()).error.code).toBe("unauthorized")

      const revoked = await context.createToken({ kind: "agent", createdBy: user })
      await context.database
         .update(tokens)
         .set({ revokedAt: new Date() })
         .where(eq(tokens.id, revoked.token.id))
      const revokedResponse = await context.request("GET", "/api/me", {
         credentials: { bearer: revoked.secret }
      })
      expect(revokedResponse.status).toBe(401)

      const expired = await context.createToken({ kind: "agent", createdBy: user })
      await context.database
         .update(tokens)
         .set({ expiresAt: new Date(Date.now() - 1000) })
         .where(eq(tokens.id, expired.token.id))
      const expiredResponse = await context.request("GET", "/api/me", {
         credentials: { bearer: expired.secret }
      })
      expect(expiredResponse.status).toBe(401)
   })

   it("rejects a malformed Authorization header even with a valid cookie", async () => {
      const response = await context.request("GET", "/api/me", {
         credentials: { cookie },
         headers: { Authorization: "Basic abc" }
      })
      expect(response.status).toBe(401)
   })

   it("keeps site-restricted tokens inside their site", async () => {
      const ownSquawk = await context.request("POST", "/api/squawks", {
         credentials: { cookie },
         body: squawkForm(
            { siteKey: "restricted-own", page: "/", body: "own", screenshot: screenshotMetadata },
            tinyPng
         )
      })
      const foreignSquawk = await context.request("POST", "/api/squawks", {
         credentials: { cookie },
         body: squawkForm(
            { siteKey: "restricted-foreign", page: "/", body: "x", screenshot: screenshotMetadata },
            tinyPng
         )
      })
      const own = (await ownSquawk.json()) as { id: string; screenshot: { url: string } }
      const foreign = (await foreignSquawk.json()) as { id: string; screenshot: { url: string } }

      const { secret } = await context.createToken({
         kind: "agent",
         createdBy: user,
         siteKey: "restricted-own"
      })
      const bearer = { bearer: secret }

      const sites = await context.request("GET", "/api/sites", { credentials: bearer })
      const siteKeys = listSitesResponseSchema.parse(await sites.json()).items.map(site => site.key)
      expect(siteKeys).toEqual(["restricted-own"])

      const list = await context.request("GET", "/api/squawks?status=all", { credentials: bearer })
      const listed = ((await list.json()) as { items: { id: string }[] }).items.map(item => item.id)
      expect(listed).toEqual([own.id])

      const crossSiteList = await context.request("GET", "/api/squawks?site=restricted-foreign", {
         credentials: bearer
      })
      expect(crossSiteList.status).toBe(404)

      expect(
         (await context.request("GET", `/api/squawks/${own.id}`, { credentials: bearer })).status
      ).toBe(200)
      for (const [method, path, json] of [
         ["GET", `/api/squawks/${foreign.id}`, undefined],
         ["POST", `/api/squawks/${foreign.id}/comments`, { body: "hi" }],
         ["PATCH", `/api/squawks/${foreign.id}`, { status: "resolved" }],
         ["GET", foreign.screenshot.url, undefined],
         ["PATCH", "/api/sites/restricted-foreign", { displayName: "x" }]
      ] as const) {
         const response = await context.request(method, path, { credentials: bearer, json })
         expect(response.status, `${method} ${path}`).toBe(404)
      }

      const createElsewhere = await context.request("POST", "/api/squawks", {
         credentials: bearer,
         body: squawkForm({ siteKey: "restricted-foreign", page: "/", body: "x" })
      })
      expect(createElsewhere.status).toBe(404)
   })
})

describe("session cookie", () => {
   it("rejects requests without credentials and forged cookies", async () => {
      expect((await context.request("GET", "/api/me")).status).toBe(401)
      const forged = await context.request("GET", "/api/me", {
         credentials: { cookie: "squawk_session=eyJhbGciOiJIUzI1NiJ9.e30.invalid" }
      })
      expect(forged.status).toBe(401)
   })

   it("blocks cookie-authenticated writes that are not JSON", async () => {
      const textPlain = await context.request("PATCH", "/api/sites/anything", {
         credentials: { cookie },
         headers: { "Content-Type": "text/plain" },
         body: JSON.stringify({ displayName: "x" })
      })
      expect(textPlain.status).toBe(403)
      expect(errorResponseSchema.parse(await textPlain.json()).error.code).toBe("forbidden")

      const multipartTokenRequest = await context.request("POST", "/api/tokens", {
         credentials: { cookie },
         body: squawkForm({ name: "sneaky" })
      })
      expect(multipartTokenRequest.status).toBe(403)
   })

   it("lets bearer requests skip the content-type rule", async () => {
      const { secret } = await context.createToken({ kind: "login", createdBy: user })
      const response = await context.request("POST", "/api/tokens", {
         credentials: { bearer: secret },
         headers: { "Content-Type": "text/plain" },
         body: JSON.stringify({ name: "from the CLI" })
      })
      expect(response.status).toBe(201)
   })
})

describe("development user", () => {
   it("treats requests without credentials as the configured user", async () => {
      const devContext = await createTestContext({ devUserEmail: "dev@example.com" })
      try {
         const me = await devContext.request("GET", "/api/me")
         expect(meResponseSchema.parse(await me.json()).principal).toMatchObject({
            kind: "user",
            email: "dev@example.com"
         })
      } finally {
         await devContext.close()
      }
   })
})

describe("CORS", () => {
   it("reflects the origin without credentials on /api", async () => {
      const preflight = await context.request("OPTIONS", "/api/squawks", {
         headers: {
            Origin: "https://preview.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization"
         }
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get("access-control-allow-origin")).toBe(
         "https://preview.example.com"
      )
      expect(preflight.headers.get("access-control-allow-methods")).toBe(
         "GET,POST,PATCH,DELETE,OPTIONS"
      )
      expect(preflight.headers.get("access-control-allow-headers")).toBe(
         "Authorization,Content-Type"
      )
      expect(preflight.headers.get("access-control-max-age")).toBe("3600")
      expect(preflight.headers.get("access-control-allow-credentials")).toBeNull()

      const simple = await context.request("GET", "/api/me", {
         headers: { Origin: "https://preview.example.com" }
      })
      expect(simple.headers.get("access-control-allow-origin")).toBe("https://preview.example.com")
   })

   it("sends no CORS headers on /auth", async () => {
      const response = await context.request("GET", "/auth/login", {
         headers: { Origin: "https://preview.example.com" }
      })
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
   })
})
