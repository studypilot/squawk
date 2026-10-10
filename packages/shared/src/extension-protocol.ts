/*
 * Messages exchanged through `window.postMessage` between the overlay (page world) and the
 * Squawk browser extension's content script (isolated world). Every message carries
 * `source: "squawk"` and a `type`; nothing else on the page is expected to use that marker.
 */

export const EXTENSION_MESSAGE_SOURCE = "squawk" as const

export interface ExtensionPingMessage {
   source: typeof EXTENSION_MESSAGE_SOURCE
   type: "ext:ping"
}

export interface ExtensionPongMessage {
   source: typeof EXTENSION_MESSAGE_SOURCE
   type: "ext:pong"
   version: string
}

export interface ExtensionCaptureRequestMessage {
   source: typeof EXTENSION_MESSAGE_SOURCE
   type: "ext:capture"
   requestId: string
}

export interface ExtensionCaptureResultMessage {
   source: typeof EXTENSION_MESSAGE_SOURCE
   type: "ext:captured"
   requestId: string
   /** `data:image/png;base64,…` of the visible tab area, or null with an error. */
   dataUrl: string | null
   devicePixelRatio: number
   error?: string
}

export type ExtensionMessage =
   | ExtensionPingMessage
   | ExtensionPongMessage
   | ExtensionCaptureRequestMessage
   | ExtensionCaptureResultMessage

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
   if (typeof value !== "object" || value === null) return false
   const candidate = value as { source?: unknown; type?: unknown }
   return candidate.source === EXTENSION_MESSAGE_SOURCE && typeof candidate.type === "string"
}
