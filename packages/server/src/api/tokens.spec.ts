import {
   createTokenResponseSchema,
   errorResponseSchema,
   listTokensResponseSchema,
   tokenSchema
} from "@squawk/shared"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { UserRow } from "../db/schema"
import { createTestContext, type TestContext } from "../testing/test-context"

let context: TestContext
let owner: UserRow
let cookie: string
let otherUser: UserRow

beforeAll(async () => {
   context = await createTestContext()
   ;({ user: owner, cookie } = await context.signIn("owner@example.com"))
   otherUser = (await context.signIn("other@example.com")).user
})

afterAll(() => context.close())

describe("token management", () => {
   it("creates an agent token whose secret is shown once and works", async () => {
      const response = await context.request("POST", "/api/tokens", {
         credentials: { cookie },
         json: { name: "Claude on CI", siteKey: "token-site", expiresInDays: 7 }
      })
      expect(response.status).toBe(201)
      const created = createTokenResponseSchema.parse(await response.json())
      expect(created.secret).toMatch(/^sqk_[A-Za-z0-9]{32}$/)
      expect(created.token).toMatchObject({
         name: "Claude on CI",
         kind: "agent",
         siteKey: "token-site",
         prefix: created.secret.slice(0, 12),
         createdBy: { email: "owner@example.com" }
      })
      expect(created.token.expiresAt).not.toBeNull()

      const me = await context.request("GET", "/api/me", {
         credentials: { bearer: created.secret }
      })
      expect(me.status).toBe(200)

      const list = await context.request("GET", "/api/tokens", { credentials: { cookie } })
      const listed = listTokensResponseSchema.parse(await list.json())
      expect(JSON.stringify(listed)).not.toContain(created.secret)
   })

   it("lists own login tokens and every agent token, but not other people's login tokens", async () => {
      const ownLogin = await context.createToken({ kind: "login", createdBy: owner })
      const foreignLogin = await context.createToken({ kind: "login", createdBy: otherUser })
      const foreignAgent = await context.createToken({ kind: "agent", createdBy: otherUser })

      const response = await context.request("GET", "/api/tokens", { credentials: { cookie } })
      const ids = listTokensResponseSchema.parse(await response.json()).items.map(item => item.id)
      expect(ids).toContain(ownLogin.token.id)
      expect(ids).toContain(foreignAgent.token.id)
      expect(ids).not.toContain(foreignLogin.token.id)
   })

   it("revokes any agent token and own login tokens", async () => {
      const foreignAgent = await context.createToken({ kind: "agent", createdBy: otherUser })
      const ownLogin = await context.createToken({ kind: "login", createdBy: owner })
      const foreignLogin = await context.createToken({ kind: "login", createdBy: otherUser })

      for (const id of [foreignAgent.token.id, ownLogin.token.id]) {
         const response = await context.request("DELETE", `/api/tokens/${id}`, {
            credentials: { cookie }
         })
         expect(response.status).toBe(204)
      }
      const again = await context.request("DELETE", `/api/tokens/${ownLogin.token.id}`, {
         credentials: { cookie }
      })
      expect(again.status).toBe(204)

      const foreign = await context.request("DELETE", `/api/tokens/${foreignLogin.token.id}`, {
         credentials: { cookie }
      })
      expect(foreign.status).toBe(404)

      const revokedUse = await context.request("GET", "/api/me", {
         credentials: { bearer: foreignAgent.secret }
      })
      expect(revokedUse.status).toBe(401)

      const list = await context.request("GET", "/api/tokens", { credentials: { cookie } })
      const revoked = listTokensResponseSchema
         .parse(await list.json())
         .items.find(item => item.id === foreignAgent.token.id)
      expect(tokenSchema.parse(revoked).revokedAt).not.toBeNull()
   })

   it("lets login tokens manage tokens", async () => {
      const { secret } = await context.createToken({ kind: "login", createdBy: owner })
      const response = await context.request("GET", "/api/tokens", {
         credentials: { bearer: secret }
      })
      expect(response.status).toBe(200)
   })

   it("forbids agent tokens from listing, creating or revoking tokens", async () => {
      const agent = await context.createToken({ kind: "agent", createdBy: owner })
      const credentials = { bearer: agent.secret }
      const requests = [
         context.request("GET", "/api/tokens", { credentials }),
         context.request("POST", "/api/tokens", { credentials, json: { name: "escalate" } }),
         context.request("DELETE", `/api/tokens/${agent.token.id}`, { credentials })
      ]
      for (const response of await Promise.all(requests)) {
         expect(response.status).toBe(403)
         expect(errorResponseSchema.parse(await response.json()).error.code).toBe("forbidden")
      }
   })

   it("validates the token name", async () => {
      const response = await context.request("POST", "/api/tokens", {
         credentials: { cookie },
         json: { name: "" }
      })
      expect(response.status).toBe(400)
   })
})
