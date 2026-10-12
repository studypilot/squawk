import { randomUUID } from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
   LIMITS,
   createCommentInputSchema,
   createSquawkInputSchema,
   listSquawksQuerySchema,
   submitSquawksInputSchema,
   updateSquawkInputSchema,
   type CreateSquawkInput,
   type ListSquawksQuery,
   type ListSquawksResponse,
   type SubmitSquawksResponse
} from "@squawk/shared"
import {
   and,
   asc,
   desc,
   eq,
   getTableColumns,
   inArray,
   lt,
   ne,
   or,
   sql,
   type SQL
} from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import {
   assertSiteAccess,
   assertSquawkVisible,
   authorColumns,
   getPrincipal,
   type Principal
} from "../auth/principal"
import type { AppEnv } from "../context"
import type { Database } from "../db/index"
import { comments, screenshots, sites, squawks } from "../db/schema"
import {
   ApiError,
   conflict,
   forbidden,
   notFound,
   parseInput,
   validationError
} from "../http/errors"
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
      statusCondition(query.status, principal),
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
   const { squawk } = await findVisibleSquawk(c)
   return c.json(await loadSquawkDetail(c.var.dependencies.database, squawk))
})

squawkRoutes.post("/", async c => {
   const { database, config } = c.var.dependencies
   const principal = await getPrincipal(c)
   const { input, screenshot } = await readSquawkUpload(c.req.raw)
   assertSiteAccess(principal, input.siteKey)
   if (input.draft && principal.kind !== "user") {
      throw forbidden("Agent tokens cannot create drafts")
   }

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
               status: input.draft ? "draft" : "open",
               createdAt: now,
               submittedAt: input.draft ? null : now,
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

squawkRoutes.post("/submit", async c => {
   const { database } = c.var.dependencies
   const principal = await getPrincipal(c)
   if (principal.kind !== "user") throw forbidden("Agent tokens have no drafts to submit")
   const input = parseInput(submitSquawksInputSchema, await readJsonBody(c))
   const ids = [...new Set(input.ids)]

   await database.transaction(async transaction => {
      const submitted = await transaction
         .update(squawks)
         .set({ status: "open", submittedAt: new Date() })
         .where(
            and(
               inArray(squawks.id, ids),
               eq(squawks.status, "draft"),
               eq(squawks.authorUserId, principal.user.id)
            )
         )
         .returning({ id: squawks.id })
      // Throwing rolls the transaction back, so either every draft is submitted or none.
      if (submitted.length !== ids.length) throw notFound("Not all of these are your drafts")
   })

   const rows = await selectSquawks(database).where(inArray(squawks.id, ids))
   const rowsInRequestOrder = ids.flatMap(id => rows.filter(row => row.id === id))
   const response: SubmitSquawksResponse = {
      items: await loadSquawkViews(database, rowsInRequestOrder)
   }
   return c.json(response)
})

squawkRoutes.post("/:ref/comments", async c => {
   const { database } = c.var.dependencies
   const { principal, squawk } = await findVisibleSquawk(c)
   const input = parseInput(createCommentInputSchema, await readJsonBody(c))
   if (squawk.status === "draft") throw conflict("Drafts have no replies; edit the draft instead")

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
   const { principal, squawk } = await findVisibleSquawk(c)
   const input = parseInput(updateSquawkInputSchema, await readJsonBody(c))

   if (squawk.status === "draft") {
      if (input.status !== undefined) {
         throw conflict("Submit the draft before resolving or reopening it")
      }
      if (input.body !== undefined) await updateFirstCommentBody(database, squawk.id, input.body)
   } else if (input.body !== undefined) {
      throw conflict("Only drafts can be edited")
   } else if (input.status !== undefined && input.status !== squawk.status) {
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

squawkRoutes.delete("/:ref", async c => {
   const { database, config } = c.var.dependencies
   const { squawk } = await findVisibleSquawk(c)
   if (squawk.status !== "draft") throw conflict("Only drafts can be deleted")

   const [screenshot] = await database
      .select({ path: screenshots.path })
      .from(screenshots)
      .where(eq(screenshots.squawkId, squawk.id))
   // Comments and the screenshot row go with the squawk (on delete cascade).
   await database.delete(squawks).where(and(eq(squawks.id, squawk.id), eq(squawks.status, "draft")))
   if (screenshot) await unlink(path.join(config.dataDir, screenshot.path)).catch(() => {})
   return c.body(null, 204)
})

/** `open`, `resolved` and `all` never include drafts; `draft` lists the caller's own only. */
function statusCondition(status: ListSquawksQuery["status"], principal: Principal): SQL {
   if (status === "all") return ne(squawks.status, "draft")
   if (status !== "draft") return eq(squawks.status, status)
   if (principal.kind !== "user") return sql`false`
   return (
      and(eq(squawks.status, "draft"), eq(squawks.authorUserId, principal.user.id)) ?? sql`false`
   )
}

/** The squawk body is its oldest comment. */
async function updateFirstCommentBody(
   database: Database,
   squawkId: string,
   body: string
): Promise<void> {
   const [first] = await database
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.squawkId, squawkId))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(1)
   if (!first) throw new Error("Squawk has no first comment")
   await database.update(comments).set({ body }).where(eq(comments.id, first.id))
}

/**
 * The squawk named by the `:ref` parameter, if the caller may see it: site-restricted tokens see
 * their site only, and drafts are visible to their author only. Anything else is a 404.
 */
async function findVisibleSquawk(
   c: Context<AppEnv>
): Promise<{ principal: Principal; squawk: SquawkWithSite }> {
   const principal = await getPrincipal(c)
   const squawk = await findSquawk(c.var.dependencies.database, c.req.param("ref") ?? "")
   assertSiteAccess(principal, squawk.siteKey)
   assertSquawkVisible(principal, squawk)
   return { principal, squawk }
}

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
