import { randomUUID } from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
   LIMITS,
   createCommentInputSchema,
   createSquawkInputSchema,
   listSquawksQuerySchema,
   updateSquawkInputSchema,
   type CreateSquawkInput,
   type ListSquawksResponse
} from "@squawk/shared"
import { and, desc, eq, getTableColumns, lt, or, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { assertSiteAccess, authorColumns, getPrincipal } from "../auth/principal"
import type { AppEnv } from "../context"
import type { Database } from "../db/index"
import { comments, screenshots, sites, squawks } from "../db/schema"
import { ApiError, notFound, parseInput, validationError } from "../http/errors"
import { readJsonBody } from "../http/json"
import { isUuid } from "../uuid"
import {
   loadCommentViews,
   loadSquawkDetail,
   loadSquawkViews,
   toIsoString,
   type SquawkWithSite
} from "./views"

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const squawkRoutes = new Hono<AppEnv>()

squawkRoutes.get("/", async c => {
   const { database } = c.var.dependencies
   const principal = await getPrincipal(c)
   const query = parseInput(listSquawksQuerySchema, c.req.query())
   if (query.site) assertSiteAccess(principal, query.site)

   const conditions: (SQL | undefined)[] = [
      query.status === "all" ? undefined : eq(squawks.status, query.status),
      query.site ? eq(sites.key, query.site) : undefined,
      principal.siteRestriction ? eq(sites.key, principal.siteRestriction) : undefined,
      query.page ? eq(squawks.page, query.page) : undefined,
      query.cursor ? olderThanCursor(query.cursor) : undefined
   ]
   const rows = await selectSquawks(database)
      .where(and(...conditions))
      .orderBy(desc(squawks.createdAt), desc(squawks.id))
      .limit(query.limit + 1)

   const pageRows = rows.slice(0, query.limit)
   const lastRow = pageRows.at(-1)
   const response: ListSquawksResponse = {
      items: await loadSquawkViews(database, pageRows),
      nextCursor: rows.length > query.limit && lastRow ? encodeCursor(lastRow) : null
   }
   return c.json(response)
})

squawkRoutes.get("/:ref", async c => {
   const { database } = c.var.dependencies
   const squawk = await findSquawk(database, c.req.param("ref"))
   assertSiteAccess(await getPrincipal(c), squawk.siteKey)
   return c.json(await loadSquawkDetail(database, squawk))
})

squawkRoutes.post("/", async c => {
   const { database, config } = c.var.dependencies
   const principal = await getPrincipal(c)
   const { input, screenshot } = await readSquawkUpload(c.req.raw)
   assertSiteAccess(principal, input.siteKey)

   const screenshotId = randomUUID()
   const now = new Date()
   const relativePath = path.posix.join(
      "screenshots",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${screenshotId}.png`
   )
   const absolutePath = path.join(config.dataDir, relativePath)
   if (screenshot) {
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, screenshot)
   }

   try {
      const squawkId = await database.transaction(async transaction => {
         await transaction.insert(sites).values({ key: input.siteKey }).onConflictDoNothing()
         const [site] = await transaction
            .select({ id: sites.id })
            .from(sites)
            .where(eq(sites.key, input.siteKey))
            .for("update")
         if (!site) throw new Error("Site row missing after upsert")

         const [next] = await transaction
            .select({ number: sql`coalesce(max(${squawks.number}), 0) + 1`.mapWith(Number) })
            .from(squawks)
            .where(eq(squawks.siteId, site.id))
         const author = authorColumns(principal)
         const [created] = await transaction
            .insert(squawks)
            .values({
               siteId: site.id,
               page: input.page,
               number: next?.number ?? 1,
               anchor: input.anchor,
               meta: input.meta,
               ...author
            })
            .returning({ id: squawks.id })
         if (!created) throw new Error("Squawk insert returned no row")

         await transaction
            .insert(comments)
            .values({ squawkId: created.id, body: input.body, ...author })
         if (screenshot && input.screenshot) {
            await transaction.insert(screenshots).values({
               id: screenshotId,
               squawkId: created.id,
               path: relativePath,
               ...input.screenshot
            })
         }
         return created.id
      })
      return c.json(await loadSquawkDetail(database, await findSquawk(database, squawkId)), 201)
   } catch (error) {
      if (screenshot) await unlink(absolutePath).catch(() => {})
      throw error
   }
})

squawkRoutes.post("/:ref/comments", async c => {
   const { database } = c.var.dependencies
   const principal = await getPrincipal(c)
   const squawk = await findSquawk(database, c.req.param("ref"))
   assertSiteAccess(principal, squawk.siteKey)
   const input = parseInput(createCommentInputSchema, await readJsonBody(c))

   const [comment] = await database
      .insert(comments)
      .values({ squawkId: squawk.id, body: input.body, ...authorColumns(principal) })
      .returning()
   if (!comment) throw new Error("Comment insert returned no row")
   const [view] = await loadCommentViews(database, [comment])
   return c.json(view, 201)
})

squawkRoutes.patch("/:ref", async c => {
   const { database } = c.var.dependencies
   const principal = await getPrincipal(c)
   const squawk = await findSquawk(database, c.req.param("ref"))
   assertSiteAccess(principal, squawk.siteKey)
   const input = parseInput(updateSquawkInputSchema, await readJsonBody(c))

   if (input.status !== squawk.status) {
      const author = authorColumns(principal)
      const resolution =
         input.status === "resolved"
            ? {
                 resolvedAt: new Date(),
                 resolvedByUserId: author.authorUserId,
                 resolvedByTokenId: author.authorTokenId
              }
            : { resolvedAt: null, resolvedByUserId: null, resolvedByTokenId: null }
      await database
         .update(squawks)
         .set({ status: input.status, ...resolution })
         .where(eq(squawks.id, squawk.id))
   }
   return c.json(await loadSquawkDetail(database, await findSquawk(database, squawk.id)))
})

function selectSquawks(database: Database) {
   return database
      .select({ ...getTableColumns(squawks), siteKey: sites.key })
      .from(squawks)
      .innerJoin(sites, eq(sites.id, squawks.siteId))
}

/** Finds a squawk by uuid or by `<siteKey>#<number>`. Access checks are up to the caller. */
async function findSquawk(database: Database, ref: string): Promise<SquawkWithSite> {
   const condition = squawkRefCondition(ref)
   const [row] = condition ? await selectSquawks(database).where(condition) : []
   if (!row) throw notFound("Squawk not found")
   return row
}

function squawkRefCondition(ref: string): SQL | undefined {
   if (isUuid(ref)) return eq(squawks.id, ref)
   const separatorIndex = ref.lastIndexOf("#")
   if (separatorIndex <= 0) return undefined
   const siteKey = ref.slice(0, separatorIndex)
   const numberText = ref.slice(separatorIndex + 1)
   if (!/^[1-9][0-9]{0,8}$/.test(numberText)) return undefined
   return and(eq(sites.key, siteKey), eq(squawks.number, Number(numberText)))
}

/** Cursor: base64url of `<createdAt ISO>|<id>` of the last item on the previous page. */
function encodeCursor(row: SquawkWithSite): string {
   return Buffer.from(`${toIsoString(row.createdAt)}|${row.id}`).toString("base64url")
}

function olderThanCursor(cursor: string): SQL {
   const [createdAtText, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|")
   const createdAt = new Date(createdAtText ?? "")
   if (!id || !isUuid(id) || Number.isNaN(createdAt.getTime())) {
      throw validationError("Invalid cursor")
   }
   const condition = or(
      lt(squawks.createdAt, createdAt),
      and(eq(squawks.createdAt, createdAt), lt(squawks.id, id))
   )
   if (!condition) throw new Error("Cursor condition could not be built")
   return condition
}

interface SquawkUpload {
   input: CreateSquawkInput
   screenshot: Buffer | null
}

/** Parses the multipart upload: a `squawk` JSON part and an optional `screenshot` PNG part. */
async function readSquawkUpload(request: Request): Promise<SquawkUpload> {
   const contentType = request.headers.get("content-type") ?? ""
   if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw validationError("Send multipart/form-data with a `squawk` part")
   }
   const form = await request.formData().catch(() => {
      throw validationError("Malformed multipart body")
   })

   const squawkPart = form.get("squawk")
   if (squawkPart === null) throw validationError("Missing `squawk` part")
   const squawkJson = typeof squawkPart === "string" ? squawkPart : await squawkPart.text()
   const input = parseInput(createSquawkInputSchema, parseJson(squawkJson))
   if (Buffer.byteLength(JSON.stringify(input.anchor)) > LIMITS.anchorMaxBytes) {
      throw new ApiError(413, "payload_too_large", "Anchor exceeds 16 KB")
   }

   const screenshotPart = form.get("screenshot")
   if (screenshotPart === null) {
      if (input.screenshot) throw validationError("`screenshot` metadata sent without a file")
      return { input, screenshot: null }
   }
   if (typeof screenshotPart === "string") throw validationError("`screenshot` must be a file")
   if (!input.screenshot) throw validationError("`screenshot` metadata is required with a file")
   if (screenshotPart.size > LIMITS.screenshotMaxBytes) {
      throw new ApiError(413, "payload_too_large", "Screenshot exceeds 8 MB")
   }
   const screenshot = Buffer.from(await screenshotPart.arrayBuffer())
   if (!screenshot.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw validationError("Screenshot must be a PNG")
   }
   return { input, screenshot }
}

function parseJson(text: string): unknown {
   try {
      return JSON.parse(text)
   } catch {
      throw validationError("`squawk` part is not valid JSON")
   }
}
