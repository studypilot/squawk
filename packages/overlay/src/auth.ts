import { CONNECT_MESSAGE_TYPE, overlayStorageKey } from "@squawk/shared"
import type { ConnectMessage } from "@squawk/shared"
import { ApiError } from "./api"
import type { ApiClient } from "./api"

/** localStorage can throw (blocked storage, sandboxed frames); the overlay then just forgets. */
export function readToken(serverOrigin: string): string | null {
   try {
      return localStorage.getItem(overlayStorageKey(serverOrigin))
   } catch {
      return null
   }
}

export function writeToken(serverOrigin: string, token: string | null): void {
   try {
      const key = overlayStorageKey(serverOrigin)
      if (token) localStorage.setItem(key, token)
      else localStorage.removeItem(key)
   } catch {
      return
   }
}

export type DeviceLoginState =
   | { status: "starting" }
   | { status: "waiting"; userCode: string; verificationUrl: string }
   | { status: "approved" }
   | { status: "denied" }
   | { status: "expired" }
   | { status: "error"; message: string }

/** Device-code states plus the popup login's own: waiting for the window, cancelled, closed. */
export type LoginState =
   DeviceLoginState | { status: "popup" } | { status: "cancelled" } | { status: "closed" }

export interface DeviceLoginOptions {
   api: Pick<ApiClient, "startDeviceLogin" | "pollDeviceLogin">
   label: string
   onState: (state: DeviceLoginState) => void
   onToken: (token: string) => void
}

/** Extra wait after the server says `rate_limited`, like RFC 8628's `slow_down`. */
const SLOW_DOWN_SECONDS = 5

/**
 * Runs the device-code login: start, then poll every `interval` seconds until the code is
 * approved, denied or expired. Returns a function that stops polling.
 */
export function runDeviceLogin(options: DeviceLoginOptions): () => void {
   const { api, label, onState, onToken } = options
   let cancelled = false
   let timer: ReturnType<typeof setTimeout> | undefined

   const finish = (state: DeviceLoginState): void => {
      if (!cancelled) onState(state)
   }

   async function start(): Promise<void> {
      onState({ status: "starting" })
      try {
         const started = await api.startDeviceLogin(label)
         if (cancelled) return
         const expiresAt = Date.now() + started.expiresIn * 1000
         finish({
            status: "waiting",
            userCode: started.userCode,
            verificationUrl: started.verificationUrl
         })
         schedule(started.deviceCode, started.interval, expiresAt)
      } catch (error) {
         finish({ status: "error", message: describe(error) })
      }
   }

   function schedule(deviceCode: string, intervalSeconds: number, expiresAt: number): void {
      timer = setTimeout(
         () => void poll(deviceCode, intervalSeconds, expiresAt),
         intervalSeconds * 1000
      )
   }

   async function poll(
      deviceCode: string,
      intervalSeconds: number,
      expiresAt: number
   ): Promise<void> {
      if (cancelled) return
      if (Date.now() >= expiresAt) return finish({ status: "expired" })
      try {
         const result = await api.pollDeviceLogin(deviceCode)
         if (cancelled) return
         if (result.status === "pending") return schedule(deviceCode, intervalSeconds, expiresAt)
         if (result.status === "approved") {
            onToken(result.token)
            return finish({ status: "approved" })
         }
         finish({ status: result.status })
      } catch (error) {
         if (cancelled) return
         if (error instanceof ApiError && error.code === "rate_limited") {
            return schedule(deviceCode, intervalSeconds + SLOW_DOWN_SECONDS, expiresAt)
         }
         if (error instanceof ApiError && error.code === "network") {
            return schedule(deviceCode, intervalSeconds, expiresAt)
         }
         finish({ status: "error", message: describe(error) })
      }
   }

   void start()
   return () => {
      cancelled = true
      clearTimeout(timer)
   }
}

export interface PopupLoginOptions {
   serverOrigin: string
   /** Origin of the page the overlay runs on; the popup posts the token to exactly this origin. */
   pageOrigin: string
   onState: (state: LoginState) => void
   onToken: (token: string) => void
   /** `window.open`, injectable for tests. */
   openWindow?: (url: string, features: string) => Window | null
}

const POPUP_WIDTH = 480
const POPUP_HEIGHT = 640
const POPUP_NAME = "squawk-connect"
const POPUP_CLOSED_POLL_MS = 500

/**
 * Signs in through a popup on the server's `/connect` page, which reuses the browser session
 * there and posts a login token back. Must run synchronously inside a click handler so browsers
 * allow the window. Returns a function that stops waiting and closes the popup, or null when the
 * popup was blocked and the caller should fall back to the device-code login.
 */
export function runPopupLogin(options: PopupLoginOptions): (() => void) | null {
   const { serverOrigin, pageOrigin, onState, onToken } = options
   const openWindow =
      options.openWindow ?? ((url, features) => window.open(url, POPUP_NAME, features))
   const url = `${serverOrigin}/connect?origin=${encodeURIComponent(pageOrigin)}`
   const popup = openWindow(url, popupFeatures())
   if (!popup) return null

   let done = false
   let closedPolls = 0

   const stop = (): void => {
      done = true
      window.removeEventListener("message", onMessage)
      clearInterval(closedTimer)
   }

   function onMessage(event: MessageEvent): void {
      if (done || event.origin !== serverOrigin || event.source !== popup) return
      const data: unknown = event.data
      if (!isConnectMessage(data)) return
      stop()
      if (data.status === "ok") {
         onToken(data.token)
         onState({ status: "approved" })
         return
      }
      onState({ status: "cancelled" })
   }

   // The popup posts its message right before closing; one extra poll lets that message arrive
   // before a closed window counts as abandoned.
   const closedTimer = setInterval(() => {
      if (!popup.closed) return
      closedPolls += 1
      if (closedPolls < 2) return
      stop()
      onState({ status: "closed" })
   }, POPUP_CLOSED_POLL_MS)

   window.addEventListener("message", onMessage)
   onState({ status: "popup" })

   return () => {
      if (done) return
      stop()
      popup.close()
   }
}

/** Centered over the current window. */
function popupFeatures(): string {
   const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2))
   const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2))
   return `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`
}

function isConnectMessage(data: unknown): data is ConnectMessage {
   if (typeof data !== "object" || data === null) return false
   const message = data as { type?: unknown; status?: unknown; token?: unknown }
   if (message.type !== CONNECT_MESSAGE_TYPE) return false
   if (message.status === "cancelled") return true
   return message.status === "ok" && typeof message.token === "string" && message.token !== ""
}

function describe(error: unknown): string {
   return error instanceof Error ? error.message : "Something went wrong"
}
