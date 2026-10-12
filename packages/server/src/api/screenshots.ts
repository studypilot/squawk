import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { assertSiteAccess, assertSquawkVisible, getPrincipal } from "../auth/principal"
import type { AppEnv } from "../context"
import { screenshots, sites, squawks } from "../db/schema"
import { notFound } from "../http/errors"
import { isUuid } from "../uuid"

export const screenshotRoutes = new Hono<AppEnv>()

screenshotRoutes.get("/:id", async c => {
   const { database, config } = c.var.dependencies
   const principal = await getPrincipal(c)
   const id = c.req.param("id")
   if (!isUuid(id)) throw notFound("Screenshot not found")

   const [row] = await database
      .select({
         path: screenshots.path,
         siteKey: sites.key,
         status: squawks.status,
         authorUserId: squawks.authorUserId
      })
      .from(screenshots)
      .innerJoin(squawks, eq(squawks.id, screenshots.squawkId))
      .innerJoin(sites, eq(sites.id, squawks.siteId))
      .where(eq(screenshots.id, id))
   if (!row) throw notFound("Screenshot not found")
   assertSiteAccess(principal, row.siteKey)
   assertSquawkVisible(principal, row)

   const filePath = path.join(config.dataDir, row.path)
   const fileStats = await stat(filePath).catch(() => null)
   if (!fileStats?.isFile()) throw notFound("Screenshot file is missing")

   const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
   return c.body(body, 200, {
      "Content-Type": "image/png",
      "Content-Length": String(fileStats.size),
      "Cache-Control": "private, max-age=3600"
   })
})
