import { overlayStorageKey } from "@squawk/shared"
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

function describe(error: unknown): string {
   return error instanceof Error ? error.message : "Something went wrong"
}
