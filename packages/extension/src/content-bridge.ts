import {
   EXTENSION_MESSAGE_SOURCE,
   isExtensionMessage,
   type ExtensionCaptureResultMessage,
   type ExtensionMessage
} from "@squawk/shared"
import { describeError, type CaptureResponse } from "./runtime-messages"

/** How long a trusted pointer or key event counts as a user gesture without `userActivation`. */
export const INTERACTION_WINDOW_MS = 5_000

export interface ContentBridgeOptions {
   window: Window
   version: string
   /** Asks the background service worker for a screenshot of the visible tab. */
   requestCapture: () => Promise<CaptureResponse>
   /** Test seam: jsdom cannot create trusted events. Defaults to `event.isTrusted`. */
   isTrustedEvent?: (event: Event) => boolean
}

/**
 * Connects the page's Squawk overlay to the extension. A capture is only answered with a
 * screenshot when the same document pinged first and the user recently interacted with the page,
 * so an arbitrary page cannot take silent screenshots. Returns a function that removes all
 * listeners.
 */
export function installContentBridge(options: ContentBridgeOptions): () => void {
   const { window: targetWindow, version, requestCapture } = options
   const isTrustedEvent = options.isTrustedEvent ?? ((event: Event) => event.isTrusted)
   let handshaken = false
   let lastInteractionAt: number | undefined

   function post(message: ExtensionMessage): void {
      const origin = targetWindow.location.origin
      targetWindow.postMessage(message, origin === "null" ? "*" : origin)
   }

   function postResult(requestId: string, result: CaptureResult): void {
      const message: ExtensionCaptureResultMessage = {
         source: EXTENSION_MESSAGE_SOURCE,
         type: "ext:captured",
         requestId,
         dataUrl: result.dataUrl,
         devicePixelRatio: result.devicePixelRatio
      }
      if (result.error !== undefined) message.error = result.error
      post(message)
   }

   function hasRecentUserActivation(): boolean {
      const userActivation: UserActivation | undefined = targetWindow.navigator.userActivation
      if (userActivation) return userActivation.isActive
      if (lastInteractionAt === undefined) return false
      return Date.now() - lastInteractionAt <= INTERACTION_WINDOW_MS
   }

   async function capture(requestId: string): Promise<void> {
      const devicePixelRatio = targetWindow.devicePixelRatio
      if (!handshaken) {
         postResult(requestId, {
            dataUrl: null,
            devicePixelRatio,
            error: "Capture refused: the page did not ping the extension first."
         })
         return
      }
      if (!hasRecentUserActivation()) {
         postResult(requestId, {
            dataUrl: null,
            devicePixelRatio,
            error: "Capture refused: no recent click or key press on the page."
         })
         return
      }
      postResult(requestId, { ...(await captureSafely()), devicePixelRatio })
   }

   async function captureSafely(): Promise<{ dataUrl: string | null; error?: string }> {
      try {
         const response = await requestCapture()
         if ("dataUrl" in response) return { dataUrl: response.dataUrl }
         return { dataUrl: null, error: response.error }
      } catch (error) {
         return { dataUrl: null, error: describeError(error) }
      }
   }

   function handleMessage(event: MessageEvent): void {
      if (event.source !== targetWindow) return
      const message: unknown = event.data
      if (!isExtensionMessage(message)) return
      if (message.type === "ext:ping") {
         handshaken = true
         post({ source: EXTENSION_MESSAGE_SOURCE, type: "ext:pong", version })
         return
      }
      if (message.type !== "ext:capture") return
      if (typeof message.requestId !== "string" || message.requestId === "") return
      void capture(message.requestId)
   }

   function handleInteraction(event: Event): void {
      if (!isTrustedEvent(event)) return
      lastInteractionAt = Date.now()
   }

   targetWindow.addEventListener("message", handleMessage)
   targetWindow.addEventListener("pointerdown", handleInteraction, true)
   targetWindow.addEventListener("keydown", handleInteraction, true)

   return () => {
      targetWindow.removeEventListener("message", handleMessage)
      targetWindow.removeEventListener("pointerdown", handleInteraction, true)
      targetWindow.removeEventListener("keydown", handleInteraction, true)
   }
}

interface CaptureResult {
   dataUrl: string | null
   devicePixelRatio: number
   error?: string
}
