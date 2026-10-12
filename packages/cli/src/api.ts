import { z } from "zod"
import {
   createTokenResponseSchema,
   deviceStartResponseSchema,
   devicePollResponseSchema,
   errorResponseSchema,
   listSitesResponseSchema,
   listSquawksResponseSchema,
   listTokensResponseSchema,
   meResponseSchema,
   squawkDetailSchema,
   type createTokenInputSchema,
   type CreateTokenResponse,
   type DevicePollResponse,
   type DeviceStartResponse,
   type ErrorCode,
   type ListSquawksResponse,
   type MeResponse,
   type SquawkDetail,
   type SquawkTargetStatus,
   type Token
} from "@squawk/shared"
import { CliError, LOGIN_HINT, NotLoggedInError } from "./errors"

/** A failed API call with the server's error code, if it sent one. */
export class ApiError extends CliError {
   constructor(
      message: string,
      readonly status: number,
      readonly code: ErrorCode | null
   ) {
      super(message)
   }
}

/** The server could not be reached at all; worth retrying. */
export class NetworkError extends CliError {}

export interface ListSquawksParameters {
   site: string
   status: "open" | "resolved" | "all"
   page?: string
   /** Only squawks unread for the caller. */
   unread?: boolean
   cursor?: string
   limit?: number
}

export type CreateTokenInput = z.input<typeof createTokenInputSchema>

interface RequestOptions {
   body?: unknown
   authenticated?: boolean
}

/**
 * Typed client for the Squawk `/api`. Responses with a schema in `@squawk/shared` are validated;
 * the methods return the body exactly as the server sent it, so `--json` prints it unchanged.
 */
export class ApiClient {
   constructor(
      readonly server: string,
      private readonly token: string | null
   ) {}

   me(): Promise<MeResponse> {
      return this.requestJson("GET", "/api/me", meResponseSchema)
   }

   listSites(): Promise<z.infer<typeof listSitesResponseSchema>> {
      return this.requestJson("GET", "/api/sites", listSitesResponseSchema)
   }

   listSquawks(parameters: ListSquawksParameters): Promise<ListSquawksResponse> {
      const query = new URLSearchParams({ site: parameters.site, status: parameters.status })
      if (parameters.page !== undefined) query.set("page", parameters.page)
      if (parameters.unread === true) query.set("unread", "true")
      if (parameters.cursor !== undefined) query.set("cursor", parameters.cursor)
      if (parameters.limit !== undefined) query.set("limit", String(parameters.limit))
      return this.requestJson("GET", `/api/squawks?${query}`, listSquawksResponseSchema)
   }

   /** `ref` is the encoded path segment from `resolveRef`. */
   getSquawk(ref: string): Promise<SquawkDetail> {
      return this.requestJson("GET", `/api/squawks/${ref}`, squawkDetailSchema)
   }

   addComment(ref: string, body: string): Promise<unknown> {
      return this.requestUnchecked("POST", `/api/squawks/${ref}/comments`, { body: { body } })
   }

   setStatus(ref: string, status: SquawkTargetStatus): Promise<unknown> {
      return this.requestUnchecked("PATCH", `/api/squawks/${ref}`, { body: { status } })
   }

   /** Marks the squawk as being worked on by the caller (agents and CLI logins only). */
   async claim(ref: string): Promise<void> {
      await this.requestUnchecked("PUT", `/api/squawks/${ref}/working`, {})
   }

   /** Clears the "working on it" mark, whoever set it. */
   async releaseClaim(ref: string): Promise<void> {
      await this.requestUnchecked("DELETE", `/api/squawks/${ref}/working`, {})
   }

   /** Downloads a screenshot by the relative `screenshot.url` of a squawk. */
   async downloadScreenshot(url: string): Promise<Uint8Array> {
      if (!url.startsWith("/")) {
         throw new CliError(`Refusing to download a screenshot from outside ${this.server}: ${url}`)
      }
      const response = await this.send("GET", url, {})
      return new Uint8Array(await response.arrayBuffer())
   }

   async listTokens(): Promise<Token[]> {
      const response = await this.requestJson("GET", "/api/tokens", listTokensResponseSchema)
      return response.items
   }

   createToken(input: CreateTokenInput): Promise<CreateTokenResponse> {
      return this.requestJson("POST", "/api/tokens", createTokenResponseSchema, { body: input })
   }

   revokeToken(id: string): Promise<unknown> {
      return this.requestUnchecked("DELETE", `/api/tokens/${encodeURIComponent(id)}`, {})
   }

   startDeviceLogin(label: string): Promise<DeviceStartResponse> {
      return this.requestJson("POST", "/api/auth/device", deviceStartResponseSchema, {
         body: { kind: "cli", label },
         authenticated: false
      })
   }

   pollDeviceLogin(deviceCode: string): Promise<DevicePollResponse> {
      return this.requestJson("POST", "/api/auth/device/token", devicePollResponseSchema, {
         body: { deviceCode },
         authenticated: false
      })
   }

   private async requestJson<Schema extends z.ZodType>(
      method: string,
      path: string,
      schema: Schema,
      options: RequestOptions = {}
   ): Promise<z.infer<Schema>> {
      const body = await this.requestUnchecked(method, path, options)
      const result = schema.safeParse(body)
      if (!result.success) {
         throw new CliError(
            `Unexpected response from ${method} ${path}:\n${z.prettifyError(result.error)}`
         )
      }
      // The response schemas have no transforms or defaults, so the raw body satisfies the type
      // and keeps fields a newer server may add.
      return body as z.infer<Schema>
   }

   private async requestUnchecked(
      method: string,
      path: string,
      options: RequestOptions
   ): Promise<unknown> {
      const response = await this.send(method, path, options)
      const text = await response.text()
      if (text === "") return null
      try {
         return JSON.parse(text)
      } catch {
         throw new CliError(`Server sent invalid JSON for ${method} ${path}.`)
      }
   }

   private async send(method: string, path: string, options: RequestOptions): Promise<Response> {
      const headers: Record<string, string> = { accept: "application/json" }
      if (options.authenticated !== false) {
         if (this.token === null) throw new NotLoggedInError(`Not logged in. ${LOGIN_HINT}`)
         headers.authorization = `Bearer ${this.token}`
      }
      if (options.body !== undefined) headers["content-type"] = "application/json"

      let response: Response
      try {
         response = await fetch(`${this.server}${path}`, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
         })
      } catch (error) {
         throw new NetworkError(`Could not reach ${this.server}: ${describeError(error)}`)
      }
      if (response.ok) return response
      throw await toApiError(response, this.server)
   }
}

async function toApiError(response: Response, server: string): Promise<CliError> {
   const text = await response.text().catch(() => "")
   const parsed = errorResponseSchema.safeParse(safeJsonParse(text))
   const code = parsed.success ? parsed.data.error.code : null
   const message = parsed.success
      ? parsed.data.error.message
      : `HTTP ${response.status} ${response.statusText}`.trim()

   if (response.status === 401) {
      return new NotLoggedInError(`${server} rejected the token: ${message}. ${LOGIN_HINT}`)
   }
   return new ApiError(code ? `${message} (${code})` : message, response.status, code)
}

function safeJsonParse(text: string): unknown {
   try {
      return JSON.parse(text)
   } catch {
      return null
   }
}

function describeError(error: unknown): string {
   if (!(error instanceof Error)) return String(error)
   if (error.cause instanceof Error) return `${error.message} (${error.cause.message})`
   return error.message
}
