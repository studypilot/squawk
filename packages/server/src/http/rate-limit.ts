import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context } from "hono"
import type { AppEnv } from "../context"

/** In-memory fixed-window counter. Enough for a single replica. */
export interface RateLimiter {
   /** Counts one attempt for the key; false once the key exceeded its limit in this window. */
   tryConsume: (key: string) => boolean
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
   const windows = new Map<string, { startedAt: number; count: number }>()

   return {
      tryConsume(key) {
         const now = Date.now()
         for (const [existingKey, window] of windows) {
            if (now - window.startedAt >= windowMs) windows.delete(existingKey)
         }
         const window = windows.get(key) ?? { startedAt: now, count: 0 }
         window.count += 1
         windows.set(key, window)
         return window.count <= limit
      }
   }
}

/** The first `X-Forwarded-For` entry behind the reverse proxy, else the socket's peer address. */
export function clientAddress(c: Context<AppEnv>): string {
   const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
   if (forwarded) return forwarded
   try {
      return getConnInfo(c).remote.address ?? "unknown"
   } catch {
      // No Node socket behind this request (tests call the app directly).
      return "unknown"
   }
}
