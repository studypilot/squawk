import { access, readFile } from "node:fs/promises"
import path from "node:path"
import {
   LIMITS,
   commentSchema,
   errorResponseSchema,
   listSitesResponseSchema,
   listSquawksResponseSchema,
   squawkDetailSchema,
   submitSquawksResponseSchema,
   type SquawkDetail
} from "@squawk/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { screenshots, squawks, type UserRow } from "../db/schema"
import {
   createTestContext,
   sampleAnchor,
   screenshotMetadata,
   squawkForm,
   tinyPng,
   type Credentials,
   type TestContext
} from "../testing/test-context"

let context: TestContext
let credentials: Credentials
let ada: UserRow

beforeAll(async () => {
   context = await createTestContext()
   const signedIn = await context.signIn("ada@example.com")
   ada = signedIn.user
   credentials = { cookie: signedIn.cookie }
})

afterAll(() => context.close())

async function createSquawk(
   input: Record<string, unknown>,
   screenshot?: Buffer,
   as: Credentials = credentials
): Promise<SquawkDetail> {
   const response = await context.request("POST", "/api/squawks", {
      credentials: as,
      body: squawkForm({ page: "/", body: "Looks off", ...input }, screenshot)
   })
   expect(response.status).toBe(201)
   return squawkDetailSchema.parse(await response.json())
}

async function getDetail(reference: string, as: Credentials = credentials): Promise<Response> {
   return context.request("GET", `/api/squawks/${reference}`, { credentials: as })
}

async function listIds(query: string, as: Credentials = credentials): Promise<string[]> {
   const response = await context.request("GET", `/api/squawks?${query}`, { credentials: as })
   expect(response.status).toBe(200)
   return listSquawksResponseSchema.parse(await response.json()).items.map(item => item.id)
}

describe("POST /api/squawks", () => {
   it("creates a squawk without a screenshot and creates the site", async () => {
      const squawk = await createSquawk({ siteKey: "create-plain", anchor: sampleAnchor })

      expect(squawk).toMatchObject({
         siteKey: "create-plain",
         number: 1,
         status: "open",
         body: "Looks off",
         screenshot: null,
         commentCount: 0,
         author: { kind: "user", email: "ada@example.com" }
      })
      expect(squawk.anchor).toEqual(sampleAnchor)
      expect(squawk.comments).toHaveLength(0)
   })

   it("stores the screenshot under DATA_DIR and serves it to authenticated callers", async () => {
      const squawk = await createSquawk(
         { siteKey: "create-shot", screenshot: screenshotMetadata },
         tinyPng
      )
      expect(squawk.screenshot).toMatchObject({ width: 1, height: 1, source: "extension" })

      const [row] = await context.database
         .select()
         .from(screenshots)
         .where(eq(screenshots.id, squawk.screenshot!.id))
      expect(row?.path).toMatch(/^screenshots\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
      expect(await readFile(path.join(context.dataDir, row!.path))).toEqual(tinyPng)

      const image = await context.request("GET", squawk.screenshot!.url, { credentials })
      expect(image.status).toBe(200)
      expect(image.headers.get("content-type")).toBe("image/png")
      expect(image.headers.get("cache-control")).toBe("private, max-age=3600")
      expect(Buffer.from(await image.arrayBuffer())).toEqual(tinyPng)

      const anonymous = await context.request("GET", squawk.screenshot!.url)
      expect(anonymous.status).toBe(401)
   })

   it("numbers squawks per site", async () => {
      const first = await createSquawk({ siteKey: "numbers-a" })
      const second = await createSquawk({ siteKey: "numbers-a" })
      const other = await createSquawk({ siteKey: "numbers-b" })
      expect([first.number, second.number, other.number]).toEqual([1, 2, 1])
   })

   it("rejects files that are not PNGs", async () => {
      const response = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm(
            { siteKey: "png-check", page: "/", body: "x", screenshot: screenshotMetadata },
            Buffer.from("GIF89a not a png")
         )
      })
      expect(response.status).toBe(400)
      expect(errorResponseSchema.parse(await response.json()).error.message).toContain("PNG")
   })

   it("requires screenshot metadata with a screenshot file", async () => {
      const response = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm({ siteKey: "png-meta", page: "/", body: "x" }, tinyPng)
      })
      expect(response.status).toBe(400)
   })

   it("validates the squawk part with a readable message", async () => {
      const response = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm({ siteKey: "bad key with spaces", page: "/", body: "" })
      })
      expect(response.status).toBe(400)
      const { error } = errorResponseSchema.parse(await response.json())
      expect(error.code).toBe("validation")
      expect(error.message).toContain("siteKey")
   })

   it("rejects JSON bodies, the upload is multipart only", async () => {
      const response = await context.request("POST", "/api/squawks", {
         credentials,
         json: { siteKey: "json-upload", page: "/", body: "x" }
      })
      expect(response.status).toBe(400)
   })

   it("enforces the body, anchor and screenshot limits", async () => {
      const longBody = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm({
            siteKey: "limits",
            page: "/",
            body: "x".repeat(LIMITS.bodyMaxLength + 1)
         })
      })
      expect(longBody.status).toBe(400)

      const escapedCharacters = "\u0001".repeat(2000)
      const largeAnchor = {
         ...sampleAnchor,
         selectors: { ...sampleAnchor.selectors, css: escapedCharacters, xpath: escapedCharacters }
      }
      const anchorTooLarge = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm({ siteKey: "limits", page: "/", body: "x", anchor: largeAnchor })
      })
      expect(anchorTooLarge.status).toBe(413)

      const oversized = Buffer.alloc(LIMITS.screenshotMaxBytes + 1)
      tinyPng.copy(oversized)
      const screenshotTooLarge = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm(
            { siteKey: "limits", page: "/", body: "x", screenshot: screenshotMetadata },
            oversized
         )
      })
      expect(screenshotTooLarge.status).toBe(413)
      expect(errorResponseSchema.parse(await screenshotTooLarge.json()).error.code).toBe(
         "payload_too_large"
      )
   })

   it("rejects request bodies beyond the upload limit outright", async () => {
      const response = await context.request("POST", "/api/squawks", {
         credentials,
         body: squawkForm(
            { siteKey: "limits", page: "/", body: "x", screenshot: screenshotMetadata },
            Buffer.alloc(LIMITS.screenshotMaxBytes * 2)
         )
      })
      expect(response.status).toBe(413)
   })
})

describe("GET /api/squawks", () => {
   it("filters by site, page and status", async () => {
      const home = await createSquawk({ siteKey: "filters", page: "/home" })
      const settings = await createSquawk({ siteKey: "filters", page: "/settings" })
      await createSquawk({ siteKey: "filters-other", page: "/home" })
      await context.request("PATCH", `/api/squawks/${settings.id}`, {
         credentials,
         json: { status: "resolved" }
      })

      async function list(query: string): Promise<string[]> {
         const response = await context.request("GET", `/api/squawks?${query}`, { credentials })
         expect(response.status).toBe(200)
         return listSquawksResponseSchema.parse(await response.json()).items.map(item => item.id)
      }

      expect(await list("site=filters")).toEqual([home.id])
      expect(await list("site=filters&status=resolved")).toEqual([settings.id])
      expect((await list("site=filters&status=all")).sort()).toEqual([home.id, settings.id].sort())
      expect(await list("site=filters&page=%2Fhome&status=all")).toEqual([home.id])
   })

   it("pages newest first with a cursor", async () => {
      const created: string[] = []
      for (let index = 0; index < 5; index += 1) {
         created.push((await createSquawk({ siteKey: "paging", body: `item ${index}` })).id)
      }

      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
         const query: string = `site=paging&limit=2${cursor ? `&cursor=${cursor}` : ""}`
         const response = await context.request("GET", `/api/squawks?${query}`, { credentials })
         const page = listSquawksResponseSchema.parse(await response.json())
         seen.push(...page.items.map(item => item.id))
         cursor = page.nextCursor
         pages += 1
      } while (cursor)

      expect(pages).toBe(3)
      expect(seen.sort()).toEqual([...created].sort())

      const fullList = await context.request("GET", "/api/squawks?site=paging", { credentials })
      const items = listSquawksResponseSchema.parse(await fullList.json()).items
      const timestamps = items.map(item => item.createdAt)
      expect(timestamps).toEqual([...timestamps].sort().reverse())
   })

   it("rejects a malformed cursor", async () => {
      const response = await context.request("GET", "/api/squawks?cursor=garbage", { credentials })
      expect(response.status).toBe(400)
   })
})

describe("squawk detail, comments and status", () => {
   it("finds a squawk by uuid and by site key with number", async () => {
      const squawk = await createSquawk({ siteKey: "feature/branch-x" })

      const byId = await context.request("GET", `/api/squawks/${squawk.id}`, { credentials })
      expect(squawkDetailSchema.parse(await byId.json()).id).toBe(squawk.id)

      const reference = encodeURIComponent(`feature/branch-x#${squawk.number}`)
      const byReference = await context.request("GET", `/api/squawks/${reference}`, { credentials })
      expect(byReference.status).toBe(200)
      expect(squawkDetailSchema.parse(await byReference.json()).id).toBe(squawk.id)

      const missing = await context.request("GET", `/api/squawks/${encodeURIComponent("nope#1")}`, {
         credentials
      })
      expect(missing.status).toBe(404)
   })

   it("appends replies in order and keeps the first comment out of them", async () => {
      const squawk = await createSquawk({ siteKey: "comments", body: "First" })
      const reply = await context.request("POST", `/api/squawks/${squawk.id}/comments`, {
         credentials,
         json: { body: "Second" }
      })
      expect(reply.status).toBe(201)
      expect(commentSchema.parse(await reply.json()).body).toBe("Second")

      const detail = squawkDetailSchema.parse(
         await (await context.request("GET", `/api/squawks/${squawk.id}`, { credentials })).json()
      )
      expect(detail.body).toBe("First")
      expect(detail.commentCount).toBe(1)
      expect(detail.comments.map(comment => comment.body)).toEqual(["Second"])
   })

   it("resolves and reopens", async () => {
      const squawk = await createSquawk({ siteKey: "status" })

      const resolved = await context.request("PATCH", `/api/squawks/${squawk.id}`, {
         credentials,
         json: { status: "resolved" }
      })
      const resolvedDetail = squawkDetailSchema.parse(await resolved.json())
      expect(resolvedDetail.status).toBe("resolved")
      expect(resolvedDetail.resolvedAt).not.toBeNull()
      expect(resolvedDetail.resolvedBy).toMatchObject({ kind: "user", email: "ada@example.com" })

      const reopened = await context.request("PATCH", `/api/squawks/${squawk.id}`, {
         credentials,
         json: { status: "open" }
      })
      const reopenedDetail = squawkDetailSchema.parse(await reopened.json())
      expect(reopenedDetail.status).toBe("open")
      expect(reopenedDetail.resolvedAt).toBeNull()
      expect(reopenedDetail.resolvedBy).toBeNull()
   })

   it("rejects an invalid status", async () => {
      const squawk = await createSquawk({ siteKey: "status-invalid" })
      const response = await context.request("PATCH", `/api/squawks/${squawk.id}`, {
         credentials,
         json: { status: "closed" }
      })
      expect(response.status).toBe(400)
   })
})

describe("agent authorship", () => {
   it("marks writes through a CLI login token as the user's agent", async () => {
      const { token, secret } = await context.createToken({
         kind: "login",
         createdBy: ada,
         name: "CLI laptop.local",
         client: "cli"
      })
      const cli = { bearer: secret }
      const agent = { tokenId: token.id, name: "CLI laptop.local" }

      const squawk = await createSquawk({ siteKey: "agent-cli" }, undefined, cli)
      expect(squawk.author).toMatchObject({ kind: "user", email: "ada@example.com", agent })
      expect(squawk.lastAuthor).toEqual(squawk.author)

      const reply = await context.request("POST", `/api/squawks/${squawk.id}/comments`, {
         credentials: cli,
         json: { body: "Fixed in abc1234." }
      })
      expect(commentSchema.parse(await reply.json()).author).toMatchObject({ kind: "user", agent })

      const resolved = await context.request("PATCH", `/api/squawks/${squawk.id}`, {
         credentials: cli,
         json: { status: "resolved" }
      })
      const detail = squawkDetailSchema.parse(await resolved.json())
      expect(detail.resolvedBy).toMatchObject({ kind: "user", id: ada.id, agent })
      expect(detail.lastAuthor).toMatchObject({ kind: "user", agent })
   })

   it("keeps overlay, legacy login tokens and the browser as the user without an agent", async () => {
      const overlay = await context.createToken({
         kind: "login",
         createdBy: ada,
         client: "overlay"
      })
      const legacy = await context.createToken({ kind: "login", createdBy: ada })
      const squawk = await createSquawk({ siteKey: "agent-overlay" }, undefined, {
         bearer: overlay.secret
      })
      expect(squawk.author).toMatchObject({ kind: "user", id: ada.id, agent: null })

      const reply = await context.request("POST", `/api/squawks/${squawk.id}/comments`, {
         credentials: { bearer: legacy.secret },
         json: { body: "Still broken" }
      })
      expect(commentSchema.parse(await reply.json()).author).toMatchObject({ agent: null })
   })

   it("leaves agent tokens as agents", async () => {
      const { token, secret } = await context.createToken({
         kind: "agent",
         createdBy: ada,
         name: "Claude"
      })
      const squawk = await createSquawk({ siteKey: "agent-token" })
      const reply = await context.request("POST", `/api/squawks/${squawk.id}/comments`, {
         credentials: { bearer: secret },
         json: { body: "On it" }
      })
      expect(commentSchema.parse(await reply.json()).author).toEqual({
         kind: "agent",
         id: token.id,
         name: "Claude"
      })
   })
})

describe("last activity", () => {
   it("follows the newest comment in list and detail views", async () => {
      const squawk = await createSquawk({ siteKey: "activity" })
      expect(squawk.lastAuthor).toEqual(squawk.author)
      expect(new Date(squawk.lastActivityAt).getTime()).toBeGreaterThanOrEqual(
         new Date(squawk.createdAt).getTime()
      )
      expect(squawk.submittedAt).toBe(squawk.createdAt)

      const bob = await context.signIn("bob@example.com")
      const reply = await context.request("POST", `/api/squawks/${squawk.id}/comments`, {
         credentials: { cookie: bob.cookie },
         json: { body: "Me too" }
      })
      const comment = commentSchema.parse(await reply.json())

      const listResponse = await context.request("GET", "/api/squawks?site=activity", {
         credentials
      })
      const [item] = listSquawksResponseSchema.parse(await listResponse.json()).items
      expect(item?.lastAuthor).toMatchObject({ kind: "user", email: "bob@example.com" })
      expect(item?.lastActivityAt).toBe(comment.createdAt)
      expect(item?.author).toMatchObject({ email: "ada@example.com" })
   })
})

describe("drafts", () => {
   let bob: Credentials

   beforeAll(async () => {
      bob = { cookie: (await context.signIn("drafts-bob@example.com")).cookie }
   })

   it("creates drafts that only their author can see", async () => {
      const open = await createSquawk({ siteKey: "drafts-visibility" })
      const draft = await createSquawk(
         { siteKey: "drafts-visibility", draft: true, screenshot: screenshotMetadata },
         tinyPng
      )
      expect(draft).toMatchObject({ status: "draft", submittedAt: null, number: 2 })

      for (const status of ["open", "all", "resolved"]) {
         expect(await listIds(`site=drafts-visibility&status=${status}`)).not.toContain(draft.id)
      }
      expect(await listIds("site=drafts-visibility&status=draft")).toEqual([draft.id])
      expect(await listIds("site=drafts-visibility&status=draft", bob)).toEqual([])
      expect(await listIds("site=drafts-visibility&status=all", bob)).toEqual([open.id])

      expect((await getDetail(draft.id)).status).toBe(200)
      expect((await getDetail(draft.id, bob)).status).toBe(404)
      const reference = encodeURIComponent(`drafts-visibility#${draft.number}`)
      expect((await getDetail(reference, bob)).status).toBe(404)
      expect((await getDetail(reference)).status).toBe(200)

      const screenshotUrl = draft.screenshot!.url
      const ownImage = await context.request("GET", screenshotUrl, { credentials })
      expect(ownImage.status).toBe(200)
      const foreignImage = await context.request("GET", screenshotUrl, { credentials: bob })
      expect(foreignImage.status).toBe(404)

      const sitesResponse = await context.request("GET", "/api/sites", { credentials })
      const site = listSitesResponseSchema
         .parse(await sitesResponse.json())
         .items.find(item => item.key === "drafts-visibility")
      expect(site).toMatchObject({ openCount: 1, resolvedCount: 0 })
   })

   it("does not let agent tokens create or list drafts", async () => {
      const { secret } = await context.createToken({ kind: "agent", createdBy: ada })
      const response = await context.request("POST", "/api/squawks", {
         credentials: { bearer: secret },
         body: squawkForm({ siteKey: "drafts-agent", page: "/", body: "x", draft: true })
      })
      expect(response.status).toBe(403)

      await createSquawk({ siteKey: "drafts-agent", draft: true })
      expect(await listIds("site=drafts-agent&status=draft", { bearer: secret })).toEqual([])
   })

   it("edits the body of an own draft and rejects other edits", async () => {
      const draft = await createSquawk({ siteKey: "drafts-edit", draft: true, body: "Frist" })
      const edited = await context.request("PATCH", `/api/squawks/${draft.id}`, {
         credentials,
         json: { body: "First" }
      })
      expect(edited.status).toBe(200)
      const detail = squawkDetailSchema.parse(await edited.json())
      expect(detail).toMatchObject({ body: "First", status: "draft", commentCount: 0 })

      const resolveDraft = await context.request("PATCH", `/api/squawks/${draft.id}`, {
         credentials,
         json: { status: "resolved" }
      })
      expect(resolveDraft.status).toBe(409)

      const foreignEdit = await context.request("PATCH", `/api/squawks/${draft.id}`, {
         credentials: bob,
         json: { body: "Hijacked" }
      })
      expect(foreignEdit.status).toBe(404)

      const replyToDraft = await context.request("POST", `/api/squawks/${draft.id}/comments`, {
         credentials,
         json: { body: "A reply" }
      })
      expect(replyToDraft.status).toBe(409)

      const open = await createSquawk({ siteKey: "drafts-edit" })
      const editOpen = await context.request("PATCH", `/api/squawks/${open.id}`, {
         credentials,
         json: { body: "Rewritten" }
      })
      expect(editOpen.status).toBe(409)
      expect(errorResponseSchema.parse(await editOpen.json()).error.code).toBe("conflict")
   })

   it("deletes own drafts with their screenshot file", async () => {
      const draft = await createSquawk(
         { siteKey: "drafts-delete", draft: true, screenshot: screenshotMetadata },
         tinyPng
      )
      const [row] = await context.database
         .select()
         .from(screenshots)
         .where(eq(screenshots.squawkId, draft.id))
      const filePath = path.join(context.dataDir, row!.path)

      const foreign = await context.request("DELETE", `/api/squawks/${draft.id}`, {
         credentials: bob
      })
      expect(foreign.status).toBe(404)

      const deleted = await context.request("DELETE", `/api/squawks/${draft.id}`, { credentials })
      expect(deleted.status).toBe(204)
      expect((await getDetail(draft.id)).status).toBe(404)
      await expect(access(filePath)).rejects.toThrow()

      const open = await createSquawk({ siteKey: "drafts-delete" })
      const deleteOpen = await context.request("DELETE", `/api/squawks/${open.id}`, {
         credentials
      })
      expect(deleteOpen.status).toBe(409)
   })

   it("submits own drafts together and refuses foreign ids without changing anything", async () => {
      const first = await createSquawk({ siteKey: "drafts-submit", draft: true })
      const second = await createSquawk({ siteKey: "drafts-submit", draft: true })
      const foreign = await createSquawk({ siteKey: "drafts-submit", draft: true }, undefined, bob)

      const mixed = await context.request("POST", "/api/squawks/submit", {
         credentials,
         json: { ids: [first.id, foreign.id] }
      })
      expect(mixed.status).toBe(404)
      const [stillDraft] = await context.database
         .select({ status: squawks.status })
         .from(squawks)
         .where(eq(squawks.id, first.id))
      expect(stillDraft?.status).toBe("draft")

      const submitted = await context.request("POST", "/api/squawks/submit", {
         credentials,
         json: { ids: [second.id, first.id] }
      })
      expect(submitted.status).toBe(200)
      const { items } = submitSquawksResponseSchema.parse(await submitted.json())
      expect(items.map(item => item.id)).toEqual([second.id, first.id])
      expect(items.every(item => item.status === "open" && item.submittedAt !== null)).toBe(true)
      expect((await listIds("site=drafts-submit", bob)).sort()).toEqual(
         [first.id, second.id].sort()
      )

      const again = await context.request("POST", "/api/squawks/submit", {
         credentials,
         json: { ids: [first.id] }
      })
      expect(again.status).toBe(404)
   })

   it("does not let agent tokens submit", async () => {
      const { secret } = await context.createToken({ kind: "agent", createdBy: ada })
      const draft = await createSquawk({ siteKey: "drafts-submit-agent", draft: true })
      const response = await context.request("POST", "/api/squawks/submit", {
         credentials: { bearer: secret },
         json: { ids: [draft.id] }
      })
      expect(response.status).toBe(403)
   })
})
