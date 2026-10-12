import { z } from "zod"
import { anchorSchema } from "./anchor"
import { LIMITS } from "./constants"
import type { CONNECT_MESSAGE_TYPE } from "./constants"

/*
 * The HTTP contract between squawk-server and its three clients (overlay, inbox, CLI).
 * Every request body and response is described here with zod so that server and clients
 * validate against the same schemas. Routes are listed next to the schemas they use.
 *
 * All routes live under `/api`. Authentication is either the `squawk_session` cookie
 * (inbox, same origin) or `Authorization: Bearer sqk_…` (overlay, CLI, agents).
 * Errors are `{ error: { code, message } }` with a matching HTTP status.
 */

// ---------------------------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------------------------

/**
 * Set when an agent wrote on the user's behalf, i.e. the request carried a login token that was
 * issued to the CLI. Null when the user wrote it themselves (overlay or inbox).
 */
export const authorAgentSchema = z.object({
   tokenId: z.string().uuid(),
   /** Token label, e.g. `CLI MiniMo.local`. */
   name: z.string()
})
export type AuthorAgent = z.infer<typeof authorAgentSchema>

export const userAuthorSchema = z.object({
   kind: z.literal("user"),
   id: z.string().uuid(),
   email: z.string(),
   name: z.string().nullable(),
   avatarUrl: z.string().nullable(),
   agent: authorAgentSchema.nullable()
})

export const agentAuthorSchema = z.object({
   kind: z.literal("agent"),
   /** The token id. */
   id: z.string().uuid(),
   name: z.string()
})

export const authorSchema = z.discriminatedUnion("kind", [userAuthorSchema, agentAuthorSchema])
export type Author = z.infer<typeof authorSchema>
export type UserAuthor = z.infer<typeof userAuthorSchema>
export type AgentAuthor = z.infer<typeof agentAuthorSchema>

/** GET /api/me */
export const meResponseSchema = z.object({
   principal: authorSchema,
   /** Present when the request was authenticated with a bearer token. */
   token: z
      .object({
         id: z.string().uuid(),
         name: z.string(),
         kind: z.enum(["login", "agent"]),
         siteKey: z.string().nullable()
      })
      .nullable()
})
export type MeResponse = z.infer<typeof meResponseSchema>

// ---------------------------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------------------------

export const siteKeySchema = z
   .string()
   .min(1)
   .max(LIMITS.siteKeyMaxLength)
   .regex(/^[A-Za-z0-9._:/@-]+$/, "site key may contain letters, digits and . _ : / @ -")

export const pageKeySchema = z.string().min(1).max(LIMITS.pageKeyMaxLength)

export const siteSchema = z.object({
   key: siteKeySchema,
   displayName: z.string().nullable(),
   openCount: z.number().int().nonnegative(),
   resolvedCount: z.number().int().nonnegative(),
   lastActivityAt: z.string().datetime().nullable(),
   createdAt: z.string().datetime()
})
export type Site = z.infer<typeof siteSchema>

/** GET /api/sites */
export const listSitesResponseSchema = z.object({ items: z.array(siteSchema) })

/** PATCH /api/sites/:key */
export const updateSiteInputSchema = z.object({
   displayName: z.string().max(200).nullable()
})

// ---------------------------------------------------------------------------------------------
// Squawks and comments
// ---------------------------------------------------------------------------------------------

/**
 * `draft` squawks exist only for their author (review-style: write several, then submit them all
 * at once). They are invisible to everyone else, including agents, until submitted.
 */
export const squawkStatusSchema = z.enum(["draft", "open", "resolved"])
export type SquawkStatus = z.infer<typeof squawkStatusSchema>

/** Statuses a squawk can be moved to through PATCH; `draft` is left only via submit. */
export const squawkTargetStatusSchema = z.enum(["open", "resolved"])
export type SquawkTargetStatus = z.infer<typeof squawkTargetStatusSchema>

export const screenshotSourceSchema = z.enum(["extension", "dom"])

export const screenshotSchema = z.object({
   id: z.string().uuid(),
   width: z.number().int().positive(),
   height: z.number().int().positive(),
   devicePixelRatio: z.number().positive(),
   source: screenshotSourceSchema,
   /** Relative URL, `/api/screenshots/:id`. Requires authentication. */
   url: z.string()
})
export type Screenshot = z.infer<typeof screenshotSchema>

/** Free-form facts about the capture context. All optional so plain pages can omit everything. */
export const squawkMetaSchema = z.object({
   url: z.string().max(4000).optional(),
   title: z.string().max(500).optional(),
   userAgent: z.string().max(1000).optional(),
   viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
   devicePixelRatio: z.number().optional(),
   /** Branch, commit or build id the embedding site declares via `data-ref`. */
   ref: z.string().max(200).optional(),
   /** Version of the embedding application, if it reports one via `Squawk.setMeta`. */
   appVersion: z.string().max(200).optional(),
   /** Arbitrary extra facts from `Squawk.setMeta`; kept small. */
   extra: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
})
export type SquawkMeta = z.infer<typeof squawkMetaSchema>

export const commentSchema = z.object({
   id: z.string().uuid(),
   squawkId: z.string().uuid(),
   body: z.string(),
   author: authorSchema,
   createdAt: z.string().datetime()
})
export type Comment = z.infer<typeof commentSchema>

/** Who is working on a squawk right now: an agent token or a user's agent through the CLI. */
export const workingSchema = z.object({
   by: authorSchema,
   since: z.string().datetime()
})
export type Working = z.infer<typeof workingSchema>

export const squawkSchema = z.object({
   id: z.string().uuid(),
   siteKey: siteKeySchema,
   /** Per-site running number, shown as `#12`. */
   number: z.number().int().positive(),
   page: pageKeySchema,
   status: squawkStatusSchema,
   anchor: anchorSchema.nullable(),
   meta: squawkMetaSchema,
   screenshot: screenshotSchema.nullable(),
   /** Text of the first comment, the squawk itself. */
   body: z.string(),
   author: authorSchema,
   /** Number of replies, not counting the squawk body. */
   commentCount: z.number().int().nonnegative(),
   createdAt: z.string().datetime(),
   /** When the squawk was submitted (left `draft`). Equals `createdAt` unless it was a draft. */
   submittedAt: z.string().datetime().nullable(),
   /** Time of the newest comment, or the body if there are no replies. */
   lastActivityAt: z.string().datetime(),
   /** Author of the newest comment, or of the body if there are no replies. */
   lastAuthor: authorSchema,
   /**
    * True when there is activity the caller has not seen (per user; comments the user wrote
    * themselves count as seen, comments by their agent do not). Always false for agent tokens
    * and for drafts.
    */
   unread: z.boolean(),
   /** Set while an agent has claimed the squawk; cleared by its reply, resolve or `DELETE`. */
   working: workingSchema.nullable(),
   resolvedAt: z.string().datetime().nullable(),
   resolvedBy: authorSchema.nullable()
})
export type Squawk = z.infer<typeof squawkSchema>

export const squawkDetailSchema = squawkSchema.extend({
   /** The replies in chronological order. The squawk body itself is `body`, not a reply. */
   comments: z.array(commentSchema)
})
export type SquawkDetail = z.infer<typeof squawkDetailSchema>

/** GET /api/squawks?site=&page=&status=&cursor=&limit= */
export const listSquawksQuerySchema = z.object({
   site: siteKeySchema.optional(),
   page: pageKeySchema.optional(),
   /**
    * `open`, `resolved` and `all` (= open + resolved) never include drafts. `draft` lists only
    * the caller's own drafts.
    */
   status: z.enum(["open", "resolved", "all", "draft"]).default("open"),
   /** Only squawks that are unread for the caller. */
   unread: z.coerce.boolean().optional(),
   cursor: z.string().optional(),
   limit: z.coerce.number().int().min(1).max(200).default(LIMITS.listPageSize)
})
export type ListSquawksQuery = z.infer<typeof listSquawksQuerySchema>

export const listSquawksResponseSchema = z.object({
   items: z.array(squawkSchema),
   nextCursor: z.string().nullable()
})
export type ListSquawksResponse = z.infer<typeof listSquawksResponseSchema>

/**
 * POST /api/squawks — multipart/form-data with two parts:
 *
 * - `squawk`: JSON string matching `createSquawkInputSchema`
 * - `screenshot`: optional PNG file
 */
export const createSquawkInputSchema = z.object({
   siteKey: siteKeySchema,
   page: pageKeySchema,
   body: z.string().min(1).max(LIMITS.bodyMaxLength),
   /** Create as a private draft instead of an open squawk. */
   draft: z.boolean().default(false),
   anchor: anchorSchema.nullable().default(null),
   meta: squawkMetaSchema.default({}),
   /** Required when a `screenshot` part is sent. */
   screenshot: z
      .object({
         width: z.number().int().positive(),
         height: z.number().int().positive(),
         devicePixelRatio: z.number().positive(),
         source: screenshotSourceSchema
      })
      .optional()
})
export type CreateSquawkInput = z.infer<typeof createSquawkInputSchema>

/** POST /api/squawks/:id/comments */
export const createCommentInputSchema = z.object({
   body: z.string().min(1).max(LIMITS.bodyMaxLength)
})

/**
 * PATCH /api/squawks/:id. `status` resolves or reopens (not allowed on drafts). `body` edits the
 * text and is allowed only on the caller's own drafts.
 */
export const updateSquawkInputSchema = z
   .object({
      status: squawkTargetStatusSchema.optional(),
      body: z.string().min(1).max(LIMITS.bodyMaxLength).optional()
   })
   .refine(input => input.status !== undefined || input.body !== undefined, {
      message: "status or body is required"
   })
export type UpdateSquawkInput = z.infer<typeof updateSquawkInputSchema>

/** DELETE /api/squawks/:id — allowed only on the caller's own drafts. Responds 204. */

/**
 * POST /api/squawks/submit — turns the caller's own drafts into open squawks in one go.
 * Ids that are not the caller's drafts fail the whole request with 404.
 */
export const submitSquawksInputSchema = z.object({
   ids: z.array(z.string().uuid()).min(1).max(100)
})
export type SubmitSquawksInput = z.infer<typeof submitSquawksInputSchema>

export const submitSquawksResponseSchema = z.object({
   items: z.array(squawkSchema)
})
export type SubmitSquawksResponse = z.infer<typeof submitSquawksResponseSchema>

/**
 * PUT /api/squawks/:id/read marks the squawk read for the calling user (204); DELETE marks it
 * unread again (204). Both are no-ops for agent tokens and 404 on drafts of other users.
 *
 * PUT /api/squawks/:id/working claims the squawk for the caller (204; only agent tokens and users
 * acting through a CLI login token, 403 otherwise; a claim by someone else is replaced). DELETE
 * clears it (204, anyone). A comment, resolve or reopen by the claimant clears it as well.
 */

/** `:id` in squawk routes accepts the uuid or `<siteKey>#<number>` (URL-encoded). */
export const squawkRefSchema = z.string().min(1)

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export const tokenKindSchema = z.enum(["login", "agent"])

export const tokenSchema = z.object({
   id: z.string().uuid(),
   name: z.string(),
   /** First characters of the secret, e.g. `sqk_a1b2c3d4`. */
   prefix: z.string(),
   kind: tokenKindSchema,
   siteKey: siteKeySchema.nullable(),
   createdBy: userAuthorSchema,
   createdAt: z.string().datetime(),
   expiresAt: z.string().datetime().nullable(),
   revokedAt: z.string().datetime().nullable(),
   lastUsedAt: z.string().datetime().nullable()
})
export type Token = z.infer<typeof tokenSchema>

/** GET /api/tokens — humans only. Own login tokens plus every agent token. */
export const listTokensResponseSchema = z.object({ items: z.array(tokenSchema) })

/** POST /api/tokens — humans only. Creates an agent token. */
export const createTokenInputSchema = z.object({
   name: z.string().min(1).max(LIMITS.tokenNameMaxLength),
   siteKey: siteKeySchema.nullable().default(null),
   expiresInDays: z.number().int().min(1).max(3650).nullable().default(null)
})

export const createTokenResponseSchema = z.object({
   token: tokenSchema,
   /** The secret, shown exactly once. */
   secret: z.string()
})
export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>

// ---------------------------------------------------------------------------------------------
// Device-code login (overlay and CLI)
// ---------------------------------------------------------------------------------------------

/** POST /api/auth/device — unauthenticated. */
export const deviceStartInputSchema = z.object({
   kind: z.enum(["overlay", "cli"]),
   /** Page origin for overlays, hostname for CLIs. Shown on the approval page. */
   label: z.string().min(1).max(300)
})

export const deviceStartResponseSchema = z.object({
   deviceCode: z.string(),
   /** Human-readable, e.g. `WXYZ-1234`. */
   userCode: z.string(),
   /** Absolute URL of the approval page with the code pre-filled. */
   verificationUrl: z.string(),
   expiresIn: z.number().int(),
   interval: z.number().int()
})
export type DeviceStartResponse = z.infer<typeof deviceStartResponseSchema>

/** POST /api/auth/device/token — unauthenticated, polled by the client. */
export const devicePollInputSchema = z.object({ deviceCode: z.string() })

export const devicePollResponseSchema = z.discriminatedUnion("status", [
   z.object({ status: z.literal("pending") }),
   z.object({
      status: z.literal("approved"),
      token: z.string(),
      expiresAt: z.string().datetime(),
      principal: userAuthorSchema
   }),
   z.object({ status: z.literal("denied") }),
   /** Also returned for unknown codes, so a client cannot probe. */
   z.object({ status: z.literal("expired") })
])
export type DevicePollResponse = z.infer<typeof devicePollResponseSchema>

/** GET /api/auth/device/info?userCode= — cookie auth; what the approval page shows. */
export const deviceInfoResponseSchema = z.object({
   userCode: z.string(),
   kind: z.enum(["overlay", "cli"]),
   label: z.string(),
   expiresAt: z.string().datetime()
})

/** POST /api/auth/device/approve and /deny — cookie auth. */
export const deviceDecisionInputSchema = z.object({ userCode: z.string() })

// ---------------------------------------------------------------------------------------------
// Popup login (overlay)
// ---------------------------------------------------------------------------------------------

/** Longest page origin the popup login accepts. */
export const CONNECT_ORIGIN_MAX_LENGTH = 300

/** True for an absolute http(s) origin exactly as `location.origin` reports it. */
export function isWebOrigin(value: string): boolean {
   if (value.length > CONNECT_ORIGIN_MAX_LENGTH) return false
   try {
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value
   } catch {
      return false
   }
}

const connectOriginSchema = z
   .string()
   .refine(isWebOrigin, "origin must be an absolute http(s) origin such as https://example.com")

/** GET /api/auth/connect?origin= — browser session only; whether the popup may skip consent. */
export const connectInfoQuerySchema = z.object({ origin: connectOriginSchema })

export const connectInfoResponseSchema = z.object({
   origin: z.string(),
   /** The origin matches `SQUAWK_TRUSTED_ORIGINS`; the popup signs in without asking. */
   trusted: z.boolean()
})
export type ConnectInfoResponse = z.infer<typeof connectInfoResponseSchema>

/** POST /api/auth/connect — browser session only; issues a login token for the page origin. */
export const connectInputSchema = z.object({
   origin: connectOriginSchema,
   /** Token name; defaults to `Overlay on <hostname>` and is cut to the token name limit. */
   label: z.string().trim().max(CONNECT_ORIGIN_MAX_LENGTH).optional()
})
export type ConnectInput = z.infer<typeof connectInputSchema>

export const connectResponseSchema = z.object({
   token: z.string(),
   user: userAuthorSchema
})
export type ConnectResponse = z.infer<typeof connectResponseSchema>

/** What the popup posts to its opener, with the page origin as the target origin. */
export type ConnectMessage =
   | { type: typeof CONNECT_MESSAGE_TYPE; status: "ok"; token: string }
   | { type: typeof CONNECT_MESSAGE_TYPE; status: "cancelled" }

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const errorCodeSchema = z.enum([
   "unauthorized",
   "forbidden",
   "not_found",
   "validation",
   "rate_limited",
   "payload_too_large",
   "conflict",
   "internal"
])
export type ErrorCode = z.infer<typeof errorCodeSchema>

export const errorResponseSchema = z.object({
   error: z.object({
      code: errorCodeSchema,
      message: z.string()
   })
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
