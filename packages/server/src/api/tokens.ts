import { createTokenInputSchema } from "@squawk/shared"
import { and, desc, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { getUserPrincipal } from "../auth/principal"
import { insertToken } from "../auth/tokens"
import type { AppEnv } from "../context"
import { sites, tokens, users } from "../db/schema"
import { notFound, parseInput } from "../http/errors"
import { readJsonBody } from "../http/json"
import { isUuid } from "../uuid"
import { toTokenView } from "./views"

export const tokenRoutes = new Hono<AppEnv>()

/** Own login tokens plus every agent token, newest first, including revoked ones. */
tokenRoutes.get("/", async c => {
   const { database } = c.var.dependencies
   const { user } = await getUserPrincipal(c)
   const rows = await database
      .select({ token: tokens, siteKey: sites.key, creator: users })
      .from(tokens)
      .innerJoin(users, eq(users.id, tokens.createdByUserId))
      .leftJoin(sites, eq(sites.id, tokens.siteId))
      .where(or(eq(tokens.kind, "agent"), eq(tokens.createdByUserId, user.id)))
      .orderBy(desc(tokens.createdAt))
   return c.json({ items: rows.map(row => toTokenView(row.token, row.siteKey, row.creator)) })
})

/** Creates an agent token. The secret is in this response only. */
tokenRoutes.post("/", async c => {
   const { database } = c.var.dependencies
   const { user } = await getUserPrincipal(c)
   const input = parseInput(createTokenInputSchema, await readJsonBody(c))

   let siteId: string | null = null
   if (input.siteKey) {
      await database.insert(sites).values({ key: input.siteKey }).onConflictDoNothing()
      const [site] = await database.select().from(sites).where(eq(sites.key, input.siteKey))
      siteId = site?.id ?? null
   }
   const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null
   const { token, secret } = await insertToken(database, {
      name: input.name,
      kind: "agent",
      siteId,
      createdBy: user,
      expiresAt
   })
   return c.json({ token: toTokenView(token, input.siteKey, user), secret }, 201)
})

/** Revokes a token. Any agent token, or the caller's own login token. Idempotent. */
tokenRoutes.delete("/:id", async c => {
   const { database } = c.var.dependencies
   const { user } = await getUserPrincipal(c)
   const id = c.req.param("id")
   if (!isUuid(id)) throw notFound("Token not found")

   const [token] = await database
      .select()
      .from(tokens)
      .where(
         and(eq(tokens.id, id), or(eq(tokens.kind, "agent"), eq(tokens.createdByUserId, user.id)))
      )
   if (!token) throw notFound("Token not found")
   if (!token.revokedAt) {
      await database.update(tokens).set({ revokedAt: new Date() }).where(eq(tokens.id, id))
   }
   return c.body(null, 204)
})
