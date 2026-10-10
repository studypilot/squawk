import { z } from "zod"
import { anchorSchema } from "./anchor"
import { LIMITS } from "./constants"

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

export const userAuthorSchema = z.object({
   kind: z.literal("user"),
   id: z.string().uuid(),
   email: z.string(),
   name: z.string().nullable(),
   avatarUrl: z.string().nullable()
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

export const squawkStatusSchema = z.enum(["open", "resolved"])
export type SquawkStatus = z.infer<typeof squawkStatusSchema>

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
   /** Text of the first comment. */
   body: z.string(),
   author: authorSchema,
   commentCount: z.number().int().nonnegative(),
   createdAt: z.string().datetime(),
   resolvedAt: z.string().datetime().nullable(),
   resolvedBy: authorSchema.nullable()
})
export type Squawk = z.infer<typeof squawkSchema>

export const squawkDetailSchema = squawkSchema.extend({
   comments: z.array(commentSchema)
})
export type SquawkDetail = z.infer<typeof squawkDetailSchema>

/** GET /api/squawks?site=&page=&status=&cursor=&limit= */
export const listSquawksQuerySchema = z.object({
   site: siteKeySchema.optional(),
   page: pageKeySchema.optional(),
   status: z.enum(["open", "resolved", "all"]).default("open"),
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

/** PATCH /api/squawks/:id */
export const updateSquawkInputSchema = z.object({
   status: squawkStatusSchema
})

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
