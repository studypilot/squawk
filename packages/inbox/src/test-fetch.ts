import { vi } from "vitest"

export interface RecordedRequest {
   method: string
   url: string
   headers: Record<string, string>
   body: unknown
}

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown }

/**
 * Replaces `fetch` with a router over `"METHOD /path"` keys (query string ignored) and records
 * every request. Unknown routes answer 404.
 */
export function mockFetch(handlers: Record<string, Handler>): RecordedRequest[] {
   const requests: RecordedRequest[] = []
   vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
         const request: RecordedRequest = {
            method: init.method ?? "GET",
            url: input,
            headers: { ...(init.headers as Record<string, string> | undefined) },
            body: typeof init.body === "string" ? JSON.parse(init.body) : undefined
         }
         requests.push(request)
         const path = input.split("?")[0] ?? input
         const handler = handlers[`${request.method} ${path}`]
         const result = handler === undefined ? { status: 404, body: notFound } : handler(request)
         const status = result.status ?? 200
         const text = result.body === undefined ? "" : JSON.stringify(result.body)
         return new Response(status === 204 ? null : text, {
            status,
            headers: { "Content-Type": "application/json" }
         })
      })
   )
   return requests
}

const notFound = { error: { code: "not_found", message: "Not found" } }

export const userAuthor = {
   kind: "user" as const,
   id: "6f1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e6f",
   email: "ada@example.com",
   name: "Ada Lovelace",
   avatarUrl: null,
   agent: null
}
