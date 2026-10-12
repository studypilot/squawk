import {
   listSitesResponseSchema,
   listSquawksResponseSchema,
   squawkDetailSchema,
   type SquawkDetail
} from "@squawk/shared"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { UserRow } from "../db/schema"
import {
   createTestContext,
   squawkForm,
   type Credentials,
   type TestContext
} from "../testing/test-context"

let context: TestContext
let ada: UserRow
let adaBrowser: Credentials
let adaCli: Credentials
let adaCliTokenId: string
let adaOverlay: Credentials
let bob: Credentials
let agent: Credentials
let agentTokenId: string

beforeAll(async () => {
   context = await createTestContext()
   const signedIn = await context.signIn("ada@example.com")
   ada = signedIn.user
   adaBrowser = { cookie: signedIn.cookie }
   const cli = await context.createToken({
      kind: "login",
      createdBy: ada,
      name: "CLI laptop.local",
      client: "cli"
   })
   adaCli = { bearer: cli.secret }
   adaCliTokenId = cli.token.id
   const overlay = await context.createToken({ kind: "login", createdBy: ada, client: "overlay" })
   adaOverlay = { bearer: overlay.secret }
   bob = { cookie: (await context.signIn("bob@example.com")).cookie }
   const agentToken = await context.createToken({ kind: "agent", createdBy: ada, name: "Claude" })
   agent = { bearer: agentToken.secret }
   agentTokenId = agentToken.token.id
})

afterAll(() => context.close())

async function createSquawk(
   siteKey: string,
   as: Credentials,
   input: Record<string, unknown> = {}
): Promise<SquawkDetail> {
   const response = await context.request("POST", "/api/squawks", {
      credentials: as,
      body: squawkForm({ siteKey, page: "/", body: "Looks off", ...input })
   })
   expect(response.status).toBe(201)
   return squawkDetailSchema.parse(await response.json())
}

async function detail(id: string, as: Credentials): Promise<SquawkDetail> {
   const response = await context.request("GET", `/api/squawks/${id}`, { credentials: as })
   expect(response.status).toBe(200)
   return squawkDetailSchema.parse(await response.json())
}

async function isUnread(id: string, as: Credentials): Promise<boolean> {
   return (await detail(id, as)).unread
}

async function reply(id: string, as: Credentials, body = "Reply"): Promise<void> {
   const response = await context.request("POST", `/api/squawks/${id}/comments`, {
      credentials: as,
      json: { body }
   })
   expect(response.status).toBe(201)
}

async function setStatus(id: string, as: Credentials, status: "open" | "resolved") {
   const response = await context.request("PATCH", `/api/squawks/${id}`, {
      credentials: as,
      json: { status }
   })
   expect(response.status).toBe(200)
   return squawkDetailSchema.parse(await response.json())
}

/** PUT sends an empty JSON body like the inbox does; cookie writes need the JSON content type. */
async function call(method: "PUT" | "DELETE", path: string, as: Credentials): Promise<number> {
   const json = method === "PUT" ? {} : undefined
   return (await context.request(method, path, { credentials: as, json })).status
}

async function listIds(query: string, as: Credentials): Promise<string[]> {
   const response = await context.request("GET", `/api/squawks?${query}`, { credentials: as })
   expect(response.status).toBe(200)
   return listSquawksResponseSchema.parse(await response.json()).items.map(item => item.id)
}

describe("unread", () => {
   it("is read for the author and unread for everyone else after creation", async () => {
      const squawk = await createSquawk("unread-create", adaBrowser)
      expect(squawk.unread).toBe(false)
      expect(await isUnread(squawk.id, bob)).toBe(true)
      expect(await isUnread(squawk.id, agent)).toBe(false)

      expect(await listIds("site=unread-create&unread=true", bob)).toEqual([squawk.id])
      expect(await listIds("site=unread-create&unread=true", adaBrowser)).toEqual([])
      expect(await listIds("site=unread-create&unread=false", adaBrowser)).toEqual([squawk.id])
      expect(await listIds("site=unread-create&unread=true", agent)).toEqual([])
   })

   it("turns unread on replies by others and by the user's own agent, not on own replies", async () => {
      const squawk = await createSquawk("unread-replies", adaBrowser)

      await reply(squawk.id, bob)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(true)
      expect(await isUnread(squawk.id, bob)).toBe(false)

      await reply(squawk.id, adaBrowser)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(false)
      expect(await isUnread(squawk.id, bob)).toBe(true)

      await reply(squawk.id, adaCli, "Fixed in abc1234.")
      expect(await isUnread(squawk.id, adaBrowser)).toBe(true)
      expect(await isUnread(squawk.id, adaCli)).toBe(true)

      await reply(squawk.id, adaOverlay)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(false)
   })

   it("marks read and unread explicitly and ignores agent tokens", async () => {
      const squawk = await createSquawk("unread-explicit", bob)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(true)

      expect(await call("PUT", `/api/squawks/${squawk.id}/read`, adaBrowser)).toBe(204)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(false)
      expect(await isUnread(squawk.id, bob)).toBe(false)

      expect(await call("DELETE", `/api/squawks/${squawk.id}/read`, adaBrowser)).toBe(204)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(true)

      const reference = encodeURIComponent(`unread-explicit#${squawk.number}`)
      expect(await call("PUT", `/api/squawks/${reference}/read`, adaCli)).toBe(204)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(false)

      expect(await call("PUT", `/api/squawks/${squawk.id}/read`, agent)).toBe(204)
      expect(await call("DELETE", `/api/squawks/${squawk.id}/read`, agent)).toBe(204)
      expect(await isUnread(squawk.id, agent)).toBe(false)
      expect(await isUnread(squawk.id, adaBrowser)).toBe(false)
   })

   it("counts resolve and reopen by the user as read, but not through their agent", async () => {
      const squawk = await createSquawk("unread-status", bob)
      await setStatus(squawk.id, adaCli, "resolved")
      expect(await isUnread(squawk.id, adaBrowser)).toBe(true)

      const reopened = await setStatus(squawk.id, adaBrowser, "open")
      expect(reopened.unread).toBe(false)
   })

   it("never marks drafts unread and hides foreign drafts", async () => {
      const draft = await createSquawk("unread-drafts", adaCli, { draft: true })
      expect(draft.unread).toBe(false)
      expect(await call("PUT", `/api/squawks/${draft.id}/read`, bob)).toBe(404)
      expect(await call("DELETE", `/api/squawks/${draft.id}/read`, bob)).toBe(404)
      expect(await call("DELETE", `/api/squawks/${draft.id}/read`, adaBrowser)).toBe(204)
      expect(await isUnread(draft.id, adaBrowser)).toBe(false)
      expect(await listIds("site=unread-drafts&status=draft&unread=true", adaBrowser)).toEqual([])

      const submitted = await context.request("POST", "/api/squawks/submit", {
         credentials: adaBrowser,
         json: { ids: [draft.id] }
      })
      expect(submitted.status).toBe(200)
      expect(await isUnread(draft.id, adaBrowser)).toBe(false)
      expect(await isUnread(draft.id, bob)).toBe(true)
   })

   it("counts unread squawks per site for the caller", async () => {
      await createSquawk("unread-sites", bob)
      await createSquawk("unread-sites", bob)
      await createSquawk("unread-sites", adaBrowser)
      await createSquawk("unread-sites", adaBrowser, { draft: true })

      const unreadCount = async (as: Credentials): Promise<number | undefined> => {
         const response = await context.request("GET", "/api/sites", { credentials: as })
         const { items } = listSitesResponseSchema.parse(await response.json())
         return items.find(site => site.key === "unread-sites")?.unreadCount
      }
      expect(await unreadCount(adaBrowser)).toBe(2)
      expect(await unreadCount(bob)).toBe(1)
      expect(await unreadCount(agent)).toBe(0)
   })
})

describe("working", () => {
   it("lets only agents claim and shows who works on it in every view", async () => {
      const squawk = await createSquawk("working-claim", bob)
      expect(squawk.working).toBeNull()

      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, adaBrowser)).toBe(403)
      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, adaOverlay)).toBe(403)
      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, adaCli)).toBe(204)

      const claimed = await detail(squawk.id, bob)
      expect(claimed.working?.by).toMatchObject({
         kind: "user",
         id: ada.id,
         agent: { tokenId: adaCliTokenId, name: "CLI laptop.local" }
      })
      expect(Number.isNaN(Date.parse(claimed.working?.since ?? ""))).toBe(false)
      const listed = await context.request("GET", "/api/squawks?site=working-claim", {
         credentials: bob
      })
      const [item] = listSquawksResponseSchema.parse(await listed.json()).items
      expect(item?.working).toEqual(claimed.working)

      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, agent)).toBe(204)
      expect((await detail(squawk.id, bob)).working?.by).toEqual({
         kind: "agent",
         id: agentTokenId,
         name: "Claude"
      })

      expect(await call("DELETE", `/api/squawks/${squawk.id}/working`, bob)).toBe(204)
      expect((await detail(squawk.id, bob)).working).toBeNull()
   })

   it("ends the claim when the claimant replies, not when someone else does", async () => {
      const squawk = await createSquawk("working-reply", bob)
      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, adaCli)).toBe(204)

      await reply(squawk.id, adaBrowser)
      await reply(squawk.id, agent)
      const otherCli = await context.createToken({ kind: "login", createdBy: ada, client: "cli" })
      await reply(squawk.id, { bearer: otherCli.secret })
      expect((await detail(squawk.id, bob)).working).not.toBeNull()

      await reply(squawk.id, adaCli, "Fixed in abc1234.")
      expect((await detail(squawk.id, bob)).working).toBeNull()
   })

   it("ends the claim on resolve by the claimant and keeps it on a reopen by others", async () => {
      const squawk = await createSquawk("working-status", bob)
      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, agent)).toBe(204)
      await setStatus(squawk.id, bob, "resolved")
      expect((await detail(squawk.id, bob)).working).not.toBeNull()

      const reopened = await setStatus(squawk.id, bob, "open")
      expect(reopened.working?.by).toMatchObject({ kind: "agent", id: agentTokenId })

      const resolved = await setStatus(squawk.id, agent, "resolved")
      expect(resolved.working).toBeNull()
   })

   it("refuses drafts with 409 for the author and 404 for everyone else", async () => {
      const draft = await createSquawk("working-drafts", adaCli, { draft: true })
      expect(await call("PUT", `/api/squawks/${draft.id}/working`, adaCli)).toBe(409)
      expect(await call("DELETE", `/api/squawks/${draft.id}/working`, adaBrowser)).toBe(409)
      expect(await call("PUT", `/api/squawks/${draft.id}/working`, agent)).toBe(404)
      expect(await call("DELETE", `/api/squawks/${draft.id}/working`, bob)).toBe(404)
   })

   it("keeps site-restricted tokens on their site", async () => {
      const squawk = await createSquawk("working-elsewhere", bob)
      const restricted = await context.createToken({
         kind: "agent",
         createdBy: ada,
         siteKey: "working-mine"
      })
      const credentials = { bearer: restricted.secret }
      expect(await call("PUT", `/api/squawks/${squawk.id}/working`, credentials)).toBe(404)
      expect(await call("DELETE", `/api/squawks/${squawk.id}/working`, credentials)).toBe(404)
   })
})
