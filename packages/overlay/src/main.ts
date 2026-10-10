import { version } from "../package.json"
import { createOverlay } from "./app"
import type { OverlayConfig, SquawkApi } from "./app"
import { defaultSiteKey } from "./page-key"

type QueuedCall = [method: string, ...args: unknown[]]

declare global {
   interface Window {
      Squawk?: SquawkApi | { q?: QueuedCall[] }
   }
}

const PUBLIC_METHODS = ["setPage", "setSite", "setMeta", "open", "close", "capture"] as const

/**
 * Reads the embedding script tag. The server origin is `data-server` when given (dev setups load
 * the overlay from elsewhere), otherwise the origin of the script's own URL.
 */
function readConfig(script: HTMLScriptElement | null): OverlayConfig | null {
   const server = script?.dataset.server || script?.src
   if (!script || !server) return null
   return {
      serverOrigin: new URL(server, location.href).origin,
      siteKey: script.dataset.site || defaultSiteKey(location.hostname),
      pageKey: script.dataset.page || null,
      ref: script.dataset.ref || null
   }
}

function boot(script: HTMLScriptElement | null): void {
   const existing = window.Squawk
   if (existing && "version" in existing) return
   const config = readConfig(script)
   if (!config) {
      console.warn(
         "[squawk] Cannot determine the Squawk server. Add data-server to the script tag."
      )
      return
   }
   const overlay = createOverlay(config, version)
   window.Squawk = overlay
   const queue = existing && "q" in existing && Array.isArray(existing.q) ? existing.q : []
   for (const [method, ...args] of queue) {
      const name = PUBLIC_METHODS.find(candidate => candidate === method)
      if (!name) continue
      ;(overlay[name] as (...parameters: unknown[]) => void)(...args)
   }
}

// `currentScript` is only set while the script runs synchronously, so read it before waiting.
const script =
   (document.currentScript as HTMLScriptElement | null) ??
   document.querySelector<HTMLScriptElement>("script[data-server], script[src*='squawk.js']")

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", () => boot(script), { once: true })
} else {
   boot(script)
}
