import { listSitesResponseSchema, siteSchema } from "@squawk/shared"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestContext, squawkForm, type TestContext } from "../testing/test-context"

let context: TestContext
let cookie: string

beforeAll(async () => {
   context = await createTestContext()
   cookie = (await context.signIn("site@example.com")).cookie
})

afterAll(() => context.close())

async function createSquawk(siteKey: string): Promise<string> {
   const response = await context.request("POST", "/api/squawks", {
      credentials: { cookie },
      body: squawkForm({ siteKey, page: "/", body: "x" })
   })
   return ((await response.json()) as { id: string }).id
}

describe("sites", () => {
   it("lists sites with counts, most recently active first", async () => {
      await createSquawk("older")
      const toResolve = await createSquawk("newer")
      await createSquawk("newer")
      await context.request("PATCH", `/api/squawks/${toResolve}`, {
         credentials: { cookie },
         json: { status: "resolved" }
      })

      const response = await context.request("GET", "/api/sites", { credentials: { cookie } })
      const { items } = listSitesResponseSchema.parse(await response.json())
      expect(items.map(site => site.key)).toEqual(["newer", "older"])
      expect(items[0]).toMatchObject({ openCount: 1, resolvedCount: 1, displayName: null })
      expect(items[0]?.lastActivityAt).not.toBeNull()
   })

   it("renames a site and 404s for unknown sites", async () => {
      await createSquawk("feature/rename-me")
      const response = await context.request(
         "PATCH",
         `/api/sites/${encodeURIComponent("feature/rename-me")}`,
         { credentials: { cookie }, json: { displayName: "Rename me" } }
      )
      expect(response.status).toBe(200)
      expect(siteSchema.parse(await response.json())).toMatchObject({
         key: "feature/rename-me",
         displayName: "Rename me",
         openCount: 1
      })

      const missing = await context.request("PATCH", "/api/sites/missing", {
         credentials: { cookie },
         json: { displayName: "x" }
      })
      expect(missing.status).toBe(404)
   })
})
