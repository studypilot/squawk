import {
   commentSchema,
   devicePollResponseSchema,
   deviceStartResponseSchema,
   listSquawksResponseSchema,
   meResponseSchema,
   squawkDetailSchema,
   squawkSchema,
   submitSquawksResponseSchema
} from "@squawk/shared"
import type {
   Comment,
   CreateSquawkInput,
   DevicePollResponse,
   DeviceStartResponse,
   ErrorCode,
   ListSquawksResponse,
   MeResponse,
   Squawk,
   SquawkDetail,
   SubmitSquawksResponse,
   UpdateSquawkInput
} from "@squawk/shared"

interface ResponseTypes {
   me: MeResponse
   squawkList: ListSquawksResponse
   squawkDetail: SquawkDetail
   squawk: Squawk
   submitted: SubmitSquawksResponse
   comment: Comment
   deviceStart: DeviceStartResponse
   devicePoll: DevicePollResponse
}

type ResponseKind = keyof ResponseTypes

/**
 * Response validation runs in dev builds only. Production builds see `null` here, so the zod
 * schemas (and zod itself) are tree-shaken out of squawk.js.
 */
const responseSchemas:
   { [Kind in ResponseKind]: { parse(input: unknown): ResponseTypes[Kind] } } | null = import.meta
   .env.DEV
   ? {
        me: meResponseSchema,
        squawkList: listSquawksResponseSchema,
        squawkDetail: squawkDetailSchema,
        squawk: squawkSchema,
        submitted: submitSquawksResponseSchema,
        comment: commentSchema,
        deviceStart: deviceStartResponseSchema,
        devicePoll: devicePollResponseSchema
     }
   : null

export class ApiError extends Error {
   constructor(
      readonly status: number,
      readonly code: ErrorCode | "network",
      message: string
   ) {
      super(message)
      this.name = "ApiError"
   }
}

export interface ListSquawksParams {
   site: string
   page?: string
   /** `draft` lists only the caller's own drafts; the others never include drafts. */
   status?: "open" | "resolved" | "all" | "draft"
   cursor?: string
   limit?: number
}

export interface ApiClient {
   me(): Promise<MeResponse>
   listSquawks(params: ListSquawksParams): Promise<ListSquawksResponse>
   getSquawk(id: string): Promise<SquawkDetail>
   createSquawk(input: CreateSquawkInput, screenshot: Blob | null): Promise<Squawk>
   addComment(squawkId: string, body: string): Promise<Comment>
   /** Resolves or reopens a squawk, or edits the body of an own draft. */
   updateSquawk(squawkId: string, input: UpdateSquawkInput): Promise<Squawk>
   /** Deletes an own draft. */
   deleteSquawk(squawkId: string): Promise<void>
   /** Turns own drafts into open squawks in one go. */
   submitSquawks(ids: string[]): Promise<Squawk[]>
   /** Revokes a token, here the overlay's own login token on sign-out. */
   revokeToken(tokenId: string): Promise<void>
   /** Fetches an authenticated screenshot; `path` is the relative `screenshot.url`. */
   fetchScreenshot(path: string): Promise<Blob>
   startDeviceLogin(label: string): Promise<DeviceStartResponse>
   pollDeviceLogin(deviceCode: string): Promise<DevicePollResponse>
}

export interface ApiClientOptions {
   serverOrigin: string
   getToken: () => string | null
   /** Called when an authenticated request comes back with 401. */
   onUnauthorized: () => void
   fetchImplementation?: typeof fetch
}

export function createApiClient(options: ApiClientOptions): ApiClient {
   const { serverOrigin, getToken, onUnauthorized } = options
   const fetchImplementation = options.fetchImplementation ?? ((...args) => fetch(...args))

   async function send(
      path: string,
      init: { method?: string; body?: BodyInit; json?: unknown; authenticated?: boolean } = {}
   ): Promise<Response> {
      const authenticated = init.authenticated ?? true
      const headers: Record<string, string> = {}
      const token = getToken()
      if (authenticated && token) headers.Authorization = `Bearer ${token}`
      let body = init.body
      if (init.json !== undefined) {
         headers["Content-Type"] = "application/json"
         body = JSON.stringify(init.json)
      }
      let response: Response
      try {
         response = await fetchImplementation(`${serverOrigin}/api${path}`, {
            method: init.method ?? "GET",
            headers,
            body,
            credentials: "omit"
         })
      } catch (error) {
         throw new ApiError(0, "network", error instanceof Error ? error.message : "Network error")
      }
      if (response.ok) return response
      if (response.status === 401 && authenticated) onUnauthorized()
      throw await toApiError(response)
   }

   async function json<Kind extends ResponseKind>(
      kind: Kind,
      path: string,
      init?: Parameters<typeof send>[1]
   ): Promise<ResponseTypes[Kind]> {
      const response = await send(path, init)
      const data: unknown = await response.json()
      if (responseSchemas) return responseSchemas[kind].parse(data)
      return data as ResponseTypes[Kind]
   }

   return {
      me: () => json("me", "/me"),
      listSquawks(params) {
         const query = new URLSearchParams({ site: params.site })
         if (params.page) query.set("page", params.page)
         if (params.status) query.set("status", params.status)
         if (params.cursor) query.set("cursor", params.cursor)
         if (params.limit) query.set("limit", String(params.limit))
         return json("squawkList", `/squawks?${query}`)
      },
      getSquawk: id => json("squawkDetail", `/squawks/${encodeURIComponent(id)}`),
      createSquawk(input, screenshot) {
         const form = new FormData()
         form.append("squawk", JSON.stringify(input))
         if (screenshot) form.append("screenshot", screenshot, "screenshot.png")
         return json("squawk", "/squawks", { method: "POST", body: form })
      },
      addComment: (squawkId, body) =>
         json("comment", `/squawks/${encodeURIComponent(squawkId)}/comments`, {
            method: "POST",
            json: { body }
         }),
      updateSquawk: (squawkId, input) =>
         json("squawk", `/squawks/${encodeURIComponent(squawkId)}`, {
            method: "PATCH",
            json: input
         }),
      async deleteSquawk(squawkId) {
         await send(`/squawks/${encodeURIComponent(squawkId)}`, { method: "DELETE" })
      },
      async submitSquawks(ids) {
         const result = await json("submitted", "/squawks/submit", {
            method: "POST",
            json: { ids }
         })
         return result.items
      },
      async revokeToken(tokenId) {
         await send(`/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" })
      },
      async fetchScreenshot(path) {
         const response = await send(path.replace(/^\/api/, ""))
         return response.blob()
      },
      startDeviceLogin: label =>
         json("deviceStart", "/auth/device", {
            method: "POST",
            json: { kind: "overlay", label },
            authenticated: false
         }),
      pollDeviceLogin: deviceCode =>
         json("devicePoll", "/auth/device/token", {
            method: "POST",
            json: { deviceCode },
            authenticated: false
         })
   }
}

async function toApiError(response: Response): Promise<ApiError> {
   const fallbackCode: ErrorCode = response.status === 401 ? "unauthorized" : "internal"
   try {
      const data = (await response.json()) as { error?: { code?: ErrorCode; message?: string } }
      return new ApiError(
         response.status,
         data.error?.code ?? fallbackCode,
         data.error?.message ?? response.statusText
      )
   } catch {
      return new ApiError(response.status, fallbackCode, response.statusText || "Request failed")
   }
}
