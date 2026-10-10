import { EXTENSION_MESSAGE_SOURCE, isExtensionMessage } from "@squawk/shared"
import type { ExtensionMessage } from "@squawk/shared"

export const EXTENSION_PING_TIMEOUT_MS = 300
export const EXTENSION_CAPTURE_TIMEOUT_MS = 5000

export interface ExtensionCapture {
   dataUrl: string
   devicePixelRatio: number
}

export interface ExtensionBridge {
   /** True once a pong arrived. */
   readonly available: boolean
   /** Pings the content script and resolves whether it answered in time. */
   detect(timeoutMs?: number): Promise<boolean>
   /** Asks the extension for a capture of the visible tab; null on error or timeout. */
   capture(timeoutMs?: number): Promise<ExtensionCapture | null>
}

/**
 * Talks to the Squawk extension's content script through `window.postMessage`. Only messages
 * whose `event.source` is this window are considered.
 */
export function createExtensionBridge(target: Window = window): ExtensionBridge {
   let available = false

   function post(message: ExtensionMessage): void {
      // The window posts to itself, so there is no other receiver to restrict.
      target.postMessage(message, "*")
   }

   function waitFor<Result>(
      pick: (message: ExtensionMessage) => Result | undefined,
      timeoutMs: number
   ): Promise<Result | null> {
      return new Promise(resolve => {
         const stop = (result: Result | null): void => {
            clearTimeout(timer)
            target.removeEventListener("message", listener)
            resolve(result)
         }
         const listener = (event: MessageEvent): void => {
            if (event.source !== target || !isExtensionMessage(event.data)) return
            const result = pick(event.data)
            if (result !== undefined) stop(result)
         }
         const timer = setTimeout(() => stop(null), timeoutMs)
         target.addEventListener("message", listener)
      })
   }

   return {
      get available() {
         return available
      },
      async detect(timeoutMs = EXTENSION_PING_TIMEOUT_MS) {
         const pong = waitFor(
            message => (message.type === "ext:pong" ? true : undefined),
            timeoutMs
         )
         post({ source: EXTENSION_MESSAGE_SOURCE, type: "ext:ping" })
         available = (await pong) === true
         return available
      },
      async capture(timeoutMs = EXTENSION_CAPTURE_TIMEOUT_MS) {
         const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
         const reply = waitFor(
            message =>
               message.type === "ext:captured" && message.requestId === requestId
                  ? message
                  : undefined,
            timeoutMs
         )
         post({ source: EXTENSION_MESSAGE_SOURCE, type: "ext:capture", requestId })
         const message = await reply
         if (!message?.dataUrl) return null
         return { dataUrl: message.dataUrl, devicePixelRatio: message.devicePixelRatio }
      }
   }
}
