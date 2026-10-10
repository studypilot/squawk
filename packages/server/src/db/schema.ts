import { sql } from "drizzle-orm"
import {
   check,
   index,
   integer,
   jsonb,
   pgEnum,
   pgTable,
   real,
   text,
   timestamp,
   uniqueIndex,
   uuid
} from "drizzle-orm/pg-core"
import type { Anchor, SquawkMeta } from "@squawk/shared"

/**
 * Millisecond precision keeps timestamps identical between Postgres and JavaScript dates, which
 * list cursors rely on.
 */
function timestampColumn(name: string) {
   return timestamp(name, { withTimezone: true, precision: 3, mode: "date" })
}

function createdAtColumn() {
   return timestampColumn("created_at").notNull().defaultNow()
}

function idColumn() {
   return uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`)
}

export const squawkStatusEnum = pgEnum("squawk_status", ["open", "resolved"])
export const screenshotSourceEnum = pgEnum("screenshot_source", ["extension", "dom"])
export const tokenKindEnum = pgEnum("token_kind", ["login", "agent"])
export const deviceKindEnum = pgEnum("device_kind", ["overlay", "cli"])
export const deviceStatusEnum = pgEnum("device_status", ["pending", "approved", "denied"])

export const users = pgTable("users", {
   id: idColumn(),
   email: text("email").notNull().unique(),
   name: text("name"),
   avatarUrl: text("avatar_url"),
   createdAt: createdAtColumn(),
   lastLoginAt: timestampColumn("last_login_at")
})

export const sites = pgTable("sites", {
   id: idColumn(),
   key: text("key").notNull().unique(),
   displayName: text("display_name"),
   createdAt: createdAtColumn()
})

/**
 * Login tokens come from the device-code flow and act as the user who approved them. Agent tokens
 * are created by a user with a name and act as an agent of that name.
 */
export const tokens = pgTable(
   "tokens",
   {
      id: idColumn(),
      name: text("name").notNull(),
      kind: tokenKindEnum("kind").notNull(),
      prefix: text("prefix").notNull(),
      hash: text("hash").notNull(),
      siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
      createdByUserId: uuid("created_by_user_id")
         .notNull()
         .references(() => users.id),
      createdAt: createdAtColumn(),
      expiresAt: timestampColumn("expires_at"),
      revokedAt: timestampColumn("revoked_at"),
      lastUsedAt: timestampColumn("last_used_at")
   },
   table => [uniqueIndex("tokens_hash_index").on(table.hash)]
)

export const squawks = pgTable(
   "squawks",
   {
      id: idColumn(),
      siteId: uuid("site_id")
         .notNull()
         .references(() => sites.id, { onDelete: "cascade" }),
      page: text("page").notNull(),
      number: integer("number").notNull(),
      status: squawkStatusEnum("status").notNull().default("open"),
      anchor: jsonb("anchor").$type<Anchor>(),
      meta: jsonb("meta").$type<SquawkMeta>().notNull(),
      authorUserId: uuid("author_user_id").references(() => users.id),
      authorTokenId: uuid("author_token_id").references(() => tokens.id),
      createdAt: createdAtColumn(),
      resolvedAt: timestampColumn("resolved_at"),
      resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
      resolvedByTokenId: uuid("resolved_by_token_id").references(() => tokens.id)
   },
   table => [
      index("squawks_site_status_created_index").on(table.siteId, table.status, table.createdAt),
      uniqueIndex("squawks_site_number_index").on(table.siteId, table.number),
      check("squawks_one_author", sql`num_nonnulls(author_user_id, author_token_id) = 1`),
      check(
         "squawks_resolver_matches_status",
         sql`(status = 'open' and resolved_at is null and resolved_by_user_id is null and resolved_by_token_id is null) or (status = 'resolved' and resolved_at is not null and num_nonnulls(resolved_by_user_id, resolved_by_token_id) = 1)`
      )
   ]
)

export const comments = pgTable(
   "comments",
   {
      id: idColumn(),
      squawkId: uuid("squawk_id")
         .notNull()
         .references(() => squawks.id, { onDelete: "cascade" }),
      body: text("body").notNull(),
      authorUserId: uuid("author_user_id").references(() => users.id),
      authorTokenId: uuid("author_token_id").references(() => tokens.id),
      /** Microsecond precision so the first comment (the squawk's text) always sorts first. */
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
         .notNull()
         .defaultNow()
   },
   table => [
      index("comments_squawk_created_index").on(table.squawkId, table.createdAt),
      check("comments_one_author", sql`num_nonnulls(author_user_id, author_token_id) = 1`)
   ]
)

/** One screenshot per squawk. `path` is relative to DATA_DIR and never derived from input. */
export const screenshots = pgTable("screenshots", {
   id: idColumn(),
   squawkId: uuid("squawk_id")
      .notNull()
      .unique()
      .references(() => squawks.id, { onDelete: "cascade" }),
   path: text("path").notNull(),
   width: integer("width").notNull(),
   height: integer("height").notNull(),
   devicePixelRatio: real("device_pixel_ratio").notNull(),
   source: screenshotSourceEnum("source").notNull(),
   createdAt: createdAtColumn()
})

/**
 * Pending device-code logins. The device code is stored hashed. The login token is created when
 * the client polls an approved code, so no secret is ever stored here; the row is deleted then.
 */
export const deviceCodes = pgTable(
   "device_codes",
   {
      id: idColumn(),
      deviceCodeHash: text("device_code_hash").notNull(),
      userCode: text("user_code").notNull(),
      kind: deviceKindEnum("kind").notNull(),
      label: text("label").notNull(),
      status: deviceStatusEnum("status").notNull().default("pending"),
      userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
      expiresAt: timestampColumn("expires_at").notNull(),
      lastPolledAt: timestampColumn("last_polled_at"),
      createdAt: createdAtColumn()
   },
   table => [
      uniqueIndex("device_codes_user_code_index").on(table.userCode),
      uniqueIndex("device_codes_device_code_hash_index").on(table.deviceCodeHash)
   ]
)

export type UserRow = typeof users.$inferSelect
export type TokenRow = typeof tokens.$inferSelect
export type SquawkRow = typeof squawks.$inferSelect
export type CommentRow = typeof comments.$inferSelect
export type ScreenshotRow = typeof screenshots.$inferSelect
