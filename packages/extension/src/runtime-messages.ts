/*
 * Messages between the content script and the background service worker
 * (`chrome.runtime.sendMessage`). The page never sees these; it only talks to the content script
 * through the protocol in `@squawk/shared`.
 */

export interface CaptureRequest {
   type: "capture"
}

export type CaptureResponse = { dataUrl: string } | { error: string }

export function isCaptureRequest(value: unknown): value is CaptureRequest {
   if (typeof value !== "object" || value === null) return false
   return (value as { type?: unknown }).type === "capture"
}

export function isCaptureResponse(value: unknown): value is CaptureResponse {
   if (typeof value !== "object" || value === null) return false
   const candidate = value as { dataUrl?: unknown; error?: unknown }
   return typeof candidate.dataUrl === "string" || typeof candidate.error === "string"
}

export function describeError(error: unknown): string {
   if (error instanceof Error) return error.message
   return String(error)
}
