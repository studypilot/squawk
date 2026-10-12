import { siteKeySchema, updateSiteInputSchema, type Site } from "@squawk/shared"
import { desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { assertSiteAccess, getPrincipal, type Principal } from "../auth/principal"
import type { AppEnv } from "../context"
import type { Database } from "../db/index"
import { comments, sites, squawks } from "../db/schema"
import { notFound, parseInput } from "../http/errors"
import { readJsonBody } from "../http/json"
import { readerUserId, unreadCondition } from "./read-state"
import { toIsoString } from "./views"

export const siteRoutes = new Hono<AppEnv>()

siteRoutes.get("/", async c => {
   const principal = await getPrincipal(c)
   const items = await listSites(c.var.dependencies.database, principal, principal.siteRestriction)
   return c.json({ items })
})

siteRoutes.patch("/:key", async c => {
   const { database } = c.var.dependencies
   const principal = await getPrincipal(c)
   const key = parseInput(siteKeySchema, c.req.param("key"))
   assertSiteAccess(principal, key)
   const input = parseInput(updateSiteInputSchema, await readJsonBody(c))

   const displayName = input.displayName?.trim() || null
   const updated = await database
      .update(sites)
      .set({ displayName })
      .where(eq(sites.key, key))
      .returning({ key: sites.key })
   if (updated.length === 0) throw notFound("Site not found")

   const [site] = await listSites(database, principal, key)
   return c.json(site)
})

/**
 * Sites with squawk counts, most recently active first. Activity is a comment or a resolution.
 * Drafts are private, so they count neither as squawks nor as activity. `unreadCount` is the
 * caller's.
 */
async function listSites(
   database: Database,
   principal: Principal,
   onlyKey: string | null
): Promise<Site[]> {
   const userId = readerUserId(principal)
   const unreadCount =
      userId === null
         ? sql`0`.mapWith(Number)
         : sql`count(${squawks.id}) filter (where ${unreadCondition(userId)})`.mapWith(Number)

   const lastCommentAt = sql`(
      select max(${comments.createdAt}) from ${comments}
      inner join ${squawks} on ${squawks.id} = ${comments.squawkId}
      where ${squawks.siteId} = ${sites.id} and ${squawks.status} <> 'draft'
   )`
   const lastActivityAt = sql<Date | null>`greatest(${lastCommentAt}, max(${squawks.resolvedAt}))`
      .mapWith(sites.createdAt)
      .as("last_activity_at")

   const rows = await database
      .select({
         key: sites.key,
         displayName: sites.displayName,
         createdAt: sites.createdAt,
         openCount: sql`count(${squawks.id}) filter (where ${squawks.status} = 'open')`.mapWith(
            Number
         ),
         resolvedCount:
            sql`count(${squawks.id}) filter (where ${squawks.status} = 'resolved')`.mapWith(Number),
         unreadCount,
         lastActivityAt
      })
      .from(sites)
      .leftJoin(squawks, eq(squawks.siteId, sites.id))
      .where(onlyKey === null ? undefined : eq(sites.key, onlyKey))
      .groupBy(sites.id)
      .orderBy(sql`${lastActivityAt} desc nulls last`, desc(sites.createdAt))

   return rows.map(row => ({
      key: row.key,
      displayName: row.displayName,
      openCount: row.openCount,
      resolvedCount: row.resolvedCount,
      unreadCount: row.unreadCount,
      lastActivityAt: toIsoString(row.lastActivityAt),
      createdAt: toIsoString(row.createdAt)
   }))
}
