import { readFile } from "node:fs/promises"
import path from "node:path"
import {
   LIMITS,
   commentSchema,
   errorResponseSchema,
   listSquawksResponseSchema,
   squawkDetailSchema,
   type SquawkDetail
} from "@squawk/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { screenshots } from "../db/schema"
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

beforeAll(async () => {
   context = await createTestContext()
   const { cookie } = await context.signIn("ada@example.com")
   credentials = { cookie }
})

afterAll(() => context.close())

async function createSquawk(
   input: Record<string, unknown>,
   screenshot?: Buffer
): Promise<SquawkDetail> {
   const response = await context.request("POST", "/api/squawks", {
      credentials,
      body: squawkForm({ page: "/", body: "Looks off", ...input }, screenshot)
   })
   expect(response.status).toBe(201)
   return squawkDetailSchema.parse(await response.json())
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
