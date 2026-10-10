import type {
   AgentAuthor,
   Author,
   Comment,
   Screenshot,
   Squawk,
   SquawkDetail,
   Token,
   UserAuthor
} from "@squawk/shared"
import { asc, count, eq, inArray } from "drizzle-orm"
import type { Database } from "../db/index"
import {
   comments,
   screenshots,
   tokens,
   users,
   type CommentRow,
   type ScreenshotRow,
   type SquawkRow,
   type TokenRow,
   type UserRow
} from "../db/schema"

export type SquawkWithSite = SquawkRow & { siteKey: string }

interface AuthorReference {
   userId: string | null
   tokenId: string | null
}

type AuthorResolver = (reference: AuthorReference) => Author

export function toIsoString(date: Date): string
export function toIsoString(date: Date | null): string | null
export function toIsoString(date: Date | null): string | null {
   return date ? date.toISOString() : null
}

export function toUserAuthor(user: UserRow): UserAuthor {
   return {
      kind: "user",
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl
   }
}

export function toAgentAuthor(token: TokenRow): AgentAuthor {
   return { kind: "agent", id: token.id, name: token.name }
}

export function toTokenView(token: TokenRow, siteKey: string | null, creator: UserRow): Token {
   return {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      kind: token.kind,
      siteKey,
      createdBy: toUserAuthor(creator),
      createdAt: toIsoString(token.createdAt),
      expiresAt: toIsoString(token.expiresAt),
      revokedAt: toIsoString(token.revokedAt),
      lastUsedAt: toIsoString(token.lastUsedAt)
   }
}

function toScreenshotView(screenshot: ScreenshotRow): Screenshot {
   return {
      id: screenshot.id,
      width: screenshot.width,
      height: screenshot.height,
      devicePixelRatio: screenshot.devicePixelRatio,
      source: screenshot.source,
      url: `/api/screenshots/${screenshot.id}`
   }
}

/** Loads every user and token referenced as an author in one query each. */
async function loadAuthors(
   database: Database,
   references: AuthorReference[]
): Promise<AuthorResolver> {
   const userIds = unique(references.map(reference => reference.userId))
   const tokenIds = unique(references.map(reference => reference.tokenId))
   const userRows = userIds.length
      ? await database.select().from(users).where(inArray(users.id, userIds))
      : []
   const tokenRows = tokenIds.length
      ? await database.select().from(tokens).where(inArray(tokens.id, tokenIds))
      : []
   const usersById = new Map(userRows.map(user => [user.id, user]))
   const tokensById = new Map(tokenRows.map(token => [token.id, token]))

   return reference => {
      const user = reference.userId ? usersById.get(reference.userId) : undefined
      if (user) return toUserAuthor(user)
      const token = reference.tokenId ? tokensById.get(reference.tokenId) : undefined
      if (token) return toAgentAuthor(token)
      throw new Error("Author reference points to a missing user or token")
   }
}

/** Turns squawk rows into API objects with first comment, author, counts and screenshot. */
export async function loadSquawkViews(
   database: Database,
   rows: SquawkWithSite[]
): Promise<Squawk[]> {
   if (rows.length === 0) return []
   const squawkIds = rows.map(row => row.id)

   const firstComments = await database
      .selectDistinctOn([comments.squawkId], { squawkId: comments.squawkId, body: comments.body })
      .from(comments)
      .where(inArray(comments.squawkId, squawkIds))
      .orderBy(comments.squawkId, asc(comments.createdAt), asc(comments.id))
   const commentCounts = await database
      .select({ squawkId: comments.squawkId, total: count() })
      .from(comments)
      .where(inArray(comments.squawkId, squawkIds))
      .groupBy(comments.squawkId)
   const screenshotRows = await database
      .select()
      .from(screenshots)
      .where(inArray(screenshots.squawkId, squawkIds))
   const resolveAuthor = await loadAuthors(
      database,
      rows.flatMap(row => [
         { userId: row.authorUserId, tokenId: row.authorTokenId },
         { userId: row.resolvedByUserId, tokenId: row.resolvedByTokenId }
      ])
   )

   const bodyBySquawk = new Map(firstComments.map(comment => [comment.squawkId, comment.body]))
   const countBySquawk = new Map(commentCounts.map(entry => [entry.squawkId, entry.total]))
   const screenshotBySquawk = new Map(screenshotRows.map(row => [row.squawkId, row]))

   return rows.map(row => {
      const screenshot = screenshotBySquawk.get(row.id)
      const isResolvedByAnyone = row.resolvedByUserId !== null || row.resolvedByTokenId !== null
      return {
         id: row.id,
         siteKey: row.siteKey,
         number: row.number,
         page: row.page,
         status: row.status,
         anchor: row.anchor,
         meta: row.meta,
         screenshot: screenshot ? toScreenshotView(screenshot) : null,
         body: bodyBySquawk.get(row.id) ?? "",
         author: resolveAuthor({ userId: row.authorUserId, tokenId: row.authorTokenId }),
         commentCount: Math.max((countBySquawk.get(row.id) ?? 0) - 1, 0),
         createdAt: toIsoString(row.createdAt),
         resolvedAt: toIsoString(row.resolvedAt),
         resolvedBy: isResolvedByAnyone
            ? resolveAuthor({ userId: row.resolvedByUserId, tokenId: row.resolvedByTokenId })
            : null
      }
   })
}

export async function loadSquawkDetail(
   database: Database,
   row: SquawkWithSite
): Promise<SquawkDetail> {
   const [squawk] = await loadSquawkViews(database, [row])
   if (!squawk) throw new Error("Squawk view could not be built")
   const commentRows = await database
      .select()
      .from(comments)
      .where(eq(comments.squawkId, row.id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
   // The oldest row is the squawk body itself; `comments` carries only the replies.
   return { ...squawk, comments: await loadCommentViews(database, commentRows.slice(1)) }
}

export async function loadCommentViews(database: Database, rows: CommentRow[]): Promise<Comment[]> {
   const resolveAuthor = await loadAuthors(
      database,
      rows.map(row => ({ userId: row.authorUserId, tokenId: row.authorTokenId }))
   )
   return rows.map(row => ({
      id: row.id,
      squawkId: row.squawkId,
      body: row.body,
      author: resolveAuthor({ userId: row.authorUserId, tokenId: row.authorTokenId }),
      createdAt: toIsoString(row.createdAt)
   }))
}

function unique(values: (string | null)[]): string[] {
   return [...new Set(values.filter((value): value is string => value !== null))]
}
