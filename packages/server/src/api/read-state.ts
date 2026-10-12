import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { authorColumns, type Principal } from "../auth/principal"
import type { Database } from "../db/index"
import { comments, squawkReads, squawks } from "../db/schema"

/*
 * Read state ("unread") and work claims ("an agent is working on this").
 *
 * Unread is per user: a squawk is unread when its newest comment (the body included) is newer
 * than the user's `squawk_reads.read_at`, or when there is no row. What users write themselves
 * marks the squawk read in the same transaction; what their agent writes through the CLI does
 * not, which is the point. Agent tokens have no read state.
 */

/** The user whose read state applies to this caller; null for agent tokens. */
export function readerUserId(principal: Principal): string | null {
   return principal.kind === "user" ? principal.user.id : null
}

/** True when the caller is a person writing themselves (browser, overlay), not through an agent. */
function writesAsThemselves(
   principal: Principal
): principal is Extract<Principal, { kind: "user" }> {
   return principal.kind === "user" && authorColumns(principal).authorTokenId === null
}

/**
 * Condition on `squawks` that is true when the squawk is unread for the user. Correlated
 * subqueries, so it works in list filters, view loading and per-site counts alike.
 */
export function unreadCondition(userId: string): SQL {
   return sql`(${squawks.status} <> 'draft' and (
      select max(${comments.createdAt}) from ${comments} where ${comments.squawkId} = ${squawks.id}
   ) > coalesce((
      select ${squawkReads.readAt} from ${squawkReads}
      where ${squawkReads.squawkId} = ${squawks.id} and ${squawkReads.userId} = ${userId}
   ), '-infinity'::timestamptz))`
}

/** The ids among `squawkIds` that are unread for the caller, in one query. */
export async function findUnreadIds(
   database: Database,
   principal: Principal,
   squawkIds: string[]
): Promise<Set<string>> {
   const userId = readerUserId(principal)
   if (userId === null || squawkIds.length === 0) return new Set()
   const rows = await database
      .select({ id: squawks.id })
      .from(squawks)
      .where(and(inArray(squawks.id, squawkIds), unreadCondition(userId)))
   return new Set(rows.map(row => row.id))
}

/**
 * Marks the squawks read for the user as of the current transaction time, which equals the
 * `created_at` of a comment written in the same transaction.
 */
export async function markRead(
   database: Database,
   userId: string,
   squawkIds: string[]
): Promise<void> {
   if (squawkIds.length === 0) return
   await database
      .insert(squawkReads)
      .values(squawkIds.map(squawkId => ({ squawkId, userId, readAt: sql`now()` })))
      .onConflictDoUpdate({
         target: [squawkReads.squawkId, squawkReads.userId],
         set: { readAt: sql`now()` }
      })
}

/** Marks the squawk unread again: without a row every comment counts as unseen. */
export async function markUnread(
   database: Database,
   userId: string,
   squawkId: string
): Promise<void> {
   await database
      .delete(squawkReads)
      .where(and(eq(squawkReads.squawkId, squawkId), eq(squawkReads.userId, userId)))
}

/**
 * After a write: the caller's own writes count as read, and a write by the claimant ends its
 * claim. Writes through a CLI login token (the user's agent) leave the user's read state alone.
 */
export async function afterWrite(
   database: Database,
   principal: Principal,
   squawkIds: string[],
   options: { releasesClaim: boolean }
): Promise<void> {
   if (writesAsThemselves(principal)) await markRead(database, principal.user.id, squawkIds)
   if (options.releasesClaim) await releaseClaim(database, principal, squawkIds)
}

/** Claims the squawk for the caller, replacing anyone else's claim. */
export async function claim(
   database: Database,
   principal: Principal,
   squawkId: string
): Promise<void> {
   const author = authorColumns(principal)
   await database
      .update(squawks)
      .set({
         workingUserId: author.authorUserId,
         workingTokenId: author.authorTokenId,
         workingSince: new Date()
      })
      .where(eq(squawks.id, squawkId))
}

export async function clearClaim(database: Database, squawkId: string): Promise<void> {
   await database
      .update(squawks)
      .set({ workingUserId: null, workingTokenId: null, workingSince: null })
      .where(eq(squawks.id, squawkId))
}

/**
 * Ends claims held by the caller: the same agent token, or the same user through the same CLI
 * login token. Claims by anyone else stay.
 */
async function releaseClaim(
   database: Database,
   principal: Principal,
   squawkIds: string[]
): Promise<void> {
   if (squawkIds.length === 0 || !canClaim(principal)) return
   const author = authorColumns(principal)
   await database
      .update(squawks)
      .set({ workingUserId: null, workingTokenId: null, workingSince: null })
      .where(
         and(
            inArray(squawks.id, squawkIds),
            isNotNull(squawks.workingSince),
            author.authorUserId === null
               ? isNull(squawks.workingUserId)
               : eq(squawks.workingUserId, author.authorUserId),
            author.authorTokenId === null
               ? isNull(squawks.workingTokenId)
               : eq(squawks.workingTokenId, author.authorTokenId)
         )
      )
}

/** Only agents claim: agent tokens and users acting through a CLI login token. */
export function canClaim(principal: Principal): boolean {
   return authorColumns(principal).authorTokenId !== null
}
