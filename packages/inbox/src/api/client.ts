import {
   connectInfoResponseSchema,
   connectResponseSchema,
   createTokenResponseSchema,
   deviceInfoResponseSchema,
   errorResponseSchema,
   listSitesResponseSchema,
   listSquawksResponseSchema,
   listTokensResponseSchema,
   meResponseSchema,
   squawkDetailSchema
} from "@squawk/shared"
import type {
   ConnectInfoResponse,
   ConnectResponse,
   createTokenInputSchema,
   CreateTokenResponse,
   ListSquawksResponse,
   MeResponse,
   Site,
   SquawkDetail,
   SquawkTargetStatus,
   Token
} from "@squawk/shared"

export type DeviceInfo = ReturnType<typeof deviceInfoResponseSchema.parse>
export type CreateTokenInput = ReturnType<typeof createTokenInputSchema.parse>
/** The inbox never lists drafts; they live in the overlay of their author. */
export type SquawkStatusFilter = SquawkTargetStatus | "all"

interface Schema<T> {
   parse(input: unknown): T
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export class ApiError extends Error {
   readonly status: number
   readonly code: string

   constructor(status: number, code: string, message: string) {
      super(message)
      this.name = "ApiError"
      this.status = status
      this.code = code
   }
}

/** Indirection over `window.location` so tests can observe navigations. */
export const browserLocation = {
   currentPath(): string {
      return window.location.pathname + window.location.search + window.location.hash
   },
   navigate(url: string): void {
      window.location.assign(url)
   }
}

export function loginUrl(returnTo: string): string {
   return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
}

/**
 * Same-origin JSON request with the session cookie. Every state-changing request carries
 * `Content-Type: application/json`, which the server requires as its CSRF rule. A 401 sends
 * the browser to the login page and comes back here afterwards.
 */
async function send(method: Method, path: string, body?: unknown): Promise<unknown> {
   const init: RequestInit = {
      method,
      credentials: "include",
      headers: { Accept: "application/json" }
   }
   if (method !== "GET") {
      init.headers = { Accept: "application/json", "Content-Type": "application/json" }
      init.body = JSON.stringify(body ?? {})
   }
   const response = await fetch(path, init)
   if (response.status === 401) {
      browserLocation.navigate(loginUrl(browserLocation.currentPath()))
      throw new ApiError(401, "unauthorized", "Your session has ended. Redirecting to sign in.")
   }
   const payload = await readJson(response)
   if (!response.ok) {
      throw toApiError(response.status, payload)
   }
   return payload
}

async function sendAndParse<T>(
   schema: Schema<T>,
   method: Method,
   path: string,
   body?: unknown
): Promise<T> {
   const payload = await send(method, path, body)
   try {
      return schema.parse(payload)
   } catch (error) {
      console.error(`Unexpected response from ${method} ${path}`, error)
      throw new ApiError(
         200,
         "invalid_response",
         "The server sent a response the inbox does not understand."
      )
   }
}

async function readJson(response: Response): Promise<unknown> {
   const text = await response.text()
   if (text === "") {
      return null
   }
   try {
      return JSON.parse(text)
   } catch {
      return null
   }
}

function toApiError(status: number, payload: unknown): ApiError {
   const parsed = errorResponseSchema.safeParse(payload)
   if (!parsed.success) {
      return new ApiError(status, "internal", `Request failed with status ${status}.`)
   }
   return new ApiError(status, parsed.data.error.code, parsed.data.error.message)
}

export function screenshotPath(screenshotId: string): string {
   return `/api/screenshots/${encodeURIComponent(screenshotId)}`
}

export function getMe(): Promise<MeResponse> {
   return sendAndParse(meResponseSchema, "GET", "/api/me")
}

export async function listSites(): Promise<Site[]> {
   const response = await sendAndParse(listSitesResponseSchema, "GET", "/api/sites")
   return response.items
}

export async function updateSiteDisplayName(
   siteKey: string,
   displayName: string | null
): Promise<void> {
   await send("PATCH", `/api/sites/${encodeURIComponent(siteKey)}`, { displayName })
}

export function listSquawks(query: {
   site: string
   status: SquawkStatusFilter
   cursor: string | null
   /** Only squawks with activity the signed-in user has not seen. */
   unread?: boolean
}): Promise<ListSquawksResponse> {
   const parameters = new URLSearchParams({ site: query.site, status: query.status })
   if (query.unread === true) {
      parameters.set("unread", "true")
   }
   if (query.cursor !== null) {
      parameters.set("cursor", query.cursor)
   }
   return sendAndParse(listSquawksResponseSchema, "GET", `/api/squawks?${parameters.toString()}`)
}

export function getSquawk(squawkId: string): Promise<SquawkDetail> {
   return sendAndParse(squawkDetailSchema, "GET", `/api/squawks/${encodeURIComponent(squawkId)}`)
}

export async function addComment(squawkId: string, body: string): Promise<void> {
   await send("POST", `/api/squawks/${encodeURIComponent(squawkId)}/comments`, { body })
}

export async function updateSquawkStatus(
   squawkId: string,
   status: SquawkTargetStatus
): Promise<void> {
   await send("PATCH", `/api/squawks/${encodeURIComponent(squawkId)}`, { status })
}

/** Marks the squawk read (`true`) or unread again (`false`) for the signed-in user. */
export async function setSquawkRead(squawkId: string, read: boolean): Promise<void> {
   await send(read ? "PUT" : "DELETE", `/api/squawks/${encodeURIComponent(squawkId)}/read`)
}

/** Clears the "an agent is working on this" mark. */
export async function clearSquawkWorking(squawkId: string): Promise<void> {
   await send("DELETE", `/api/squawks/${encodeURIComponent(squawkId)}/working`)
}

export async function listTokens(): Promise<Token[]> {
   const response = await sendAndParse(listTokensResponseSchema, "GET", "/api/tokens")
   return response.items
}

export function createToken(input: CreateTokenInput): Promise<CreateTokenResponse> {
   return sendAndParse(createTokenResponseSchema, "POST", "/api/tokens", input)
}

export async function revokeToken(tokenId: string): Promise<void> {
   await send("DELETE", `/api/tokens/${encodeURIComponent(tokenId)}`)
}

export function getDeviceInfo(userCode: string): Promise<DeviceInfo> {
   const parameters = new URLSearchParams({ userCode })
   return sendAndParse(
      deviceInfoResponseSchema,
      "GET",
      `/api/auth/device/info?${parameters.toString()}`
   )
}

export async function decideDevice(userCode: string, decision: "approve" | "deny"): Promise<void> {
   await send("POST", `/api/auth/device/${decision}`, { userCode })
}

export function getConnectInfo(origin: string): Promise<ConnectInfoResponse> {
   const parameters = new URLSearchParams({ origin })
   return sendAndParse(
      connectInfoResponseSchema,
      "GET",
      `/api/auth/connect?${parameters.toString()}`
   )
}

export function connectOrigin(origin: string, label: string): Promise<ConnectResponse> {
   return sendAndParse(connectResponseSchema, "POST", "/api/auth/connect", { origin, label })
}

export async function logout(): Promise<void> {
   await send("POST", "/auth/logout")
   browserLocation.navigate("/")
}
