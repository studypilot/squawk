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
