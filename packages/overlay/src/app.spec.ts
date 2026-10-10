import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SquawkApi } from "./app"
import { SQUAWK_ID, squawkFixture } from "./test-fixtures"

const SERVER = "http://localhost:3000"

function jsonResponse(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
   })
}

function shadow(): ShadowRoot {
   const root = document.getElementById("squawk-root")?.shadowRoot
   if (!root) throw new Error("overlay not mounted")
   return root
}

function text(selector: string): string {
   return shadow().querySelector(selector)?.textContent ?? ""
}

async function boot(queue: unknown[][] = []): Promise<SquawkApi> {
   const script = document.createElement("script")
   script.dataset.server = SERVER
   script.dataset.site = "feature/foo"
   document.head.append(script)
   window.Squawk = { q: queue as [string, ...unknown[]][] }
   vi.resetModules()
   await import("./main")
   await vi.advanceTimersByTimeAsync(0)
   return window.Squawk as SquawkApi
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
   vi.useFakeTimers()
   fetchMock = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.includes("/api/squawks?")) {
         return jsonResponse({ items: [squawkFixture()], nextCursor: null })
      }
      if (url.endsWith(`/api/squawks/${SQUAWK_ID}`)) {
         return jsonResponse({ ...squawkFixture(), comments: [] })
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404)
   })
   vi.stubGlobal("fetch", fetchMock)
   localStorage.setItem(`squawk:${SERVER}:token`, "sqk_secret")
})

afterEach(() => {
   document.getElementById("squawk-root")?.remove()
   document.head.innerHTML = ""
   localStorage.clear()
   delete window.Squawk
   vi.unstubAllGlobals()
   vi.useRealTimers()
   history.replaceState(null, "", "/")
})

describe("overlay bootstrap", () => {
   it("mounts on the document element, drains the queue and shows the badge", async () => {
      const squawk = await boot([["setPage", "/"]])

      expect(squawk.version).toBe("0.1.0")
      expect(document.getElementById("squawk-root")?.parentElement).toBe(document.documentElement)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("site=feature%2Ffoo")
      expect(text(".badge")).toBe("1")
   })

   it("lists squawks and opens a thread", async () => {
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)

      expect(text(".site")).toBe("feature/foo")
      expect(text(".item")).toContain("#12")
      expect(text(".item")).toContain("Button is misaligned")

      shadow().querySelector<HTMLButtonElement>(".item")?.click()
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".thread-title")).toBe("#12")
      expect(text(".message-body")).toBe("Button is misaligned")
   })

   it("opens the thread from a deep link in the hash", async () => {
      history.replaceState(null, "", `/#route?{"a":1}&squawk=${SQUAWK_ID}`)
      await boot()
      expect(text(".thread-title")).toBe("#12")
   })

   it("drops the token and shows sign-in after a 401", async () => {
      fetchMock.mockImplementation(async () =>
         jsonResponse({ error: { code: "unauthorized", message: "Revoked" } }, 401)
      )
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)

      expect(localStorage.getItem(`squawk:${SERVER}:token`)).toBeNull()
      expect(text(".sign-in")).toContain("Sign in")
   })

   it("pings the extension again once the window has loaded", async () => {
      const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined)
      const pings = () => posted.mock.calls.filter(([message]) => message.type === "ext:ping")
      Object.defineProperty(document, "readyState", { value: "interactive", configurable: true })
      try {
         await boot()
         expect(pings()).toHaveLength(1)
         window.dispatchEvent(new Event("load"))
         expect(pings()).toHaveLength(2)
         window.dispatchEvent(new Event("load"))
         expect(pings()).toHaveLength(2)
      } finally {
         Object.defineProperty(document, "readyState", { value: "complete", configurable: true })
      }
   })

   it("follows client-side navigation for the page key", async () => {
      const squawk = await boot()
      squawk.open()
      history.pushState(null, "", "/other?x=1")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".page")).toBe("/other?x=1")
      expect(text(".group-title")).toBe("/")

      squawk.setPage("fixed")
      history.pushState(null, "", "/third")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".page")).toBe("fixed")
   })
})
