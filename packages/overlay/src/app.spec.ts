import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Squawk } from "@squawk/shared"
import { version } from "../package.json"
import type { SquawkApi } from "./app"
import {
   ADA,
   ADAS_AGENT,
   DRAFT_ID,
   SQUAWK_ID,
   TOKEN_ID,
   draftFixture,
   squawkFixture
} from "./test-fixtures"

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

function click(selector: string): void {
   const element = shadow().querySelector<HTMLElement>(selector)
   if (!element) throw new Error(`${selector} not rendered`)
   element.click()
}

function press(key: string, target: EventTarget = window, init: KeyboardEventInit = {}): void {
   target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, composed: true, ...init })
   )
}

/** Requests the overlay made, as `METHOD path` plus the parsed JSON body. */
function requests(): { call: string; body: unknown }[] {
   return fetchMock.mock.calls.map(([input, init]) => ({
      call: `${init?.method ?? "GET"} ${String(input).replace(`${SERVER}/api`, "")}`,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
   }))
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

/**
 * Every test boots a fresh overlay, and the overlay has no teardown. Its window listeners and
 * DOM observer are recorded here and removed after the test, so an earlier overlay neither
 * reacts to the next test's keys nor re-mounts its host when that test advances the clock.
 */
const leftovers: (() => void)[] = []

function trackOverlaySideEffects(): void {
   const addListener = window.addEventListener.bind(window)
   vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      addListener(type, listener, options)
      leftovers.push(() => window.removeEventListener(type, listener, options))
   })
   const NativeObserver = MutationObserver
   vi.stubGlobal(
      "MutationObserver",
      class extends NativeObserver {
         constructor(callback: MutationCallback) {
            super(callback)
            leftovers.push(() => this.disconnect())
         }
      }
   )
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let drafts: Squawk[]
let listed: Squawk

beforeEach(() => {
   vi.useFakeTimers()
   trackOverlaySideEffects()
   drafts = []
   listed = squawkFixture()
   fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url.includes("/api/squawks?") && url.includes("status=draft")) {
         return jsonResponse({ items: drafts, nextCursor: null })
      }
      if (url.includes("/api/squawks?")) {
         return jsonResponse({ items: [listed], nextCursor: null })
      }
      if (url.endsWith("/api/me")) {
         return jsonResponse({
            principal: ADA,
            token: { id: TOKEN_ID, name: "Overlay", kind: "login", siteKey: null }
         })
      }
      if (url.endsWith("/api/squawks/submit")) {
         return jsonResponse({ items: drafts.map(draft => ({ ...draft, status: "open" })) })
      }
      if (url.endsWith(`/api/squawks/${DRAFT_ID}`) && method === "DELETE") {
         return new Response(null, { status: 204 })
      }
      if (url.endsWith(`/api/squawks/${DRAFT_ID}`) && method === "PATCH") {
         const body = JSON.parse(String(init?.body)) as { body: string }
         return jsonResponse(draftFixture({ body: body.body }))
      }
      if (url.endsWith(`/api/squawks/${SQUAWK_ID}`) && method === "PATCH") {
         const body = JSON.parse(String(init?.body)) as { status: "open" | "resolved" }
         return jsonResponse(squawkFixture({ status: body.status }))
      }
      if (url.endsWith(`/api/squawks/${SQUAWK_ID}/read`)) {
         listed = { ...listed, unread: method === "DELETE" }
         return new Response(null, { status: 204 })
      }
      if (url.endsWith(`/api/squawks/${SQUAWK_ID}/working`) && method === "DELETE") {
         listed = { ...listed, working: null }
         return new Response(null, { status: 204 })
      }
      if (url.endsWith(`/api/squawks/${SQUAWK_ID}`)) {
         return jsonResponse({ ...listed, comments: [] })
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404)
   })
   vi.stubGlobal("fetch", fetchMock)
   localStorage.setItem(`squawk:${SERVER}:token`, "sqk_secret")
})

afterEach(() => {
   for (const cleanUp of leftovers.splice(0)) cleanUp()
   vi.restoreAllMocks()
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

      expect(squawk.version).toBe(version)
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
      expect(text(".group-title")).toBe("/1")

      squawk.setPage("/")
      history.pushState(null, "", "/third")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".group-title")).toBe("This page1")
   })
})

describe("review drafts", () => {
   async function bootWithDraft(): Promise<SquawkApi> {
      drafts = [draftFixture()]
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)
      return squawk
   }

   it("shows own drafts in the review block and on the launcher", async () => {
      await bootWithDraft()

      expect(text(".review-head")).toContain("Your review")
      expect(text(".review-head")).toContain("1 draft")
      expect(text(".draft")).toContain("Spacing feels off")
      expect(text(".submit-review")).toBe("Submit review (1)")
      expect(text(".badge.is-draft")).toBe("1")
      // Drafts never show up in the Open list or its count.
      expect(text(".segment.is-selected .count")).toBe("1")
      expect(shadow().querySelectorAll(".item")).toHaveLength(1)
   })

   it("edits a draft inline and saves it with Enter", async () => {
      await bootWithDraft()

      click(".draft-body")
      const textarea = shadow().querySelector<HTMLTextAreaElement>(".draft.is-editing textarea")
      if (!textarea) throw new Error("editor not open")
      expect(textarea.value).toBe("Spacing feels off")
      textarea.value = "Spacing is 4px off"
      press("Enter", textarea)
      await vi.advanceTimersByTimeAsync(0)

      expect(requests()).toContainEqual({
         call: `PATCH /squawks/${DRAFT_ID}`,
         body: { body: "Spacing is 4px off" }
      })
      expect(shadow().querySelector(".draft.is-editing")).toBeNull()
      expect(text(".draft")).toContain("Spacing is 4px off")
   })

   it("deletes a draft after confirming", async () => {
      await bootWithDraft()

      click(".draft .delete")
      expect(requests().some(request => request.call.startsWith("DELETE"))).toBe(false)
      expect(text(".draft .delete")).toBe("Delete")
      click(".draft .delete")
      await vi.advanceTimersByTimeAsync(0)

      expect(requests()).toContainEqual({ call: `DELETE /squawks/${DRAFT_ID}`, body: undefined })
      expect(shadow().querySelector(".review")).toBeNull()
   })

   it("submits the review and moves the drafts into the list", async () => {
      await bootWithDraft()

      click(".submit-review")
      await vi.advanceTimersByTimeAsync(0)

      expect(requests()).toContainEqual({
         call: "POST /squawks/submit",
         body: { ids: [DRAFT_ID] }
      })
      expect(shadow().querySelector(".review")).toBeNull()
      expect(text(".toast")).toBe("1 squawk sent")
      expect(shadow().querySelectorAll(".item")).toHaveLength(2)
      expect(shadow().querySelector(".badge.is-draft")?.hasAttribute("hidden")).toBe(true)
   })
})

describe("keyboard shortcuts", () => {
   it("steps through squawks with j/k, resolves with r and undoes it", async () => {
      await boot()

      press("j")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".thread-title")).toBe("#12")

      press("r")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({
         call: `PATCH /squawks/${SQUAWK_ID}`,
         body: { status: "resolved" }
      })
      expect(text(".toast")).toContain("Squawk #12 resolved")

      click(".toast-action")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({
         call: `PATCH /squawks/${SQUAWK_ID}`,
         body: { status: "open" }
      })
   })

   it("closes the thread, then the panel with Escape", async () => {
      await boot()
      press("j")
      await vi.advanceTimersByTimeAsync(0)
      expect(shadow().querySelector(".thread")).not.toBeNull()

      press("Escape")
      expect(shadow().querySelector(".thread")).toBeNull()
      expect(shadow().querySelector(".panel")?.classList.contains("is-open")).toBe(true)

      press("Escape")
      expect(shadow().querySelector(".panel")?.classList.contains("is-open")).toBe(false)
   })

   it("starts pin mode with c, but not while typing in the page", async () => {
      await boot()
      const input = document.createElement("input")
      document.body.append(input)
      try {
         press("c", input)
         expect(shadow().querySelector(".pin-mode")?.hasAttribute("hidden")).toBe(true)

         press("c")
         expect(shadow().querySelector(".pin-mode")?.hasAttribute("hidden")).toBe(false)
         press("Escape")
         expect(shadow().querySelector(".pin-mode")?.hasAttribute("hidden")).toBe(true)
      } finally {
         input.remove()
      }
   })

   it("signs out, revoking the overlay token", async () => {
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".account")).toContain("Ada Lovelace")

      click(".panel-footer .text-button")
      await vi.advanceTimersByTimeAsync(0)

      expect(requests()).toContainEqual({ call: `DELETE /tokens/${TOKEN_ID}`, body: undefined })
      expect(localStorage.getItem(`squawk:${SERVER}:token`)).toBeNull()
      expect(text(".sign-in")).toContain("Sign in")
   })
})

describe("unread and working", () => {
   function badge(): HTMLElement | null {
      return shadow().querySelector<HTMLElement>(".badge:not(.is-draft)")
   }

   it("counts unread squawks on the launcher before open ones", async () => {
      listed = squawkFixture({ unread: true })
      await boot()
      expect(badge()?.textContent).toBe("1")
      expect(badge()?.classList.contains("is-unread")).toBe(true)
      expect(shadow().querySelector(".launcher")?.getAttribute("title")).toBe("1 unread · 1 open")
   })

   it("shows the open count quietly when everything is read", async () => {
      await boot()
      expect(badge()?.textContent).toBe("1")
      expect(badge()?.classList.contains("is-unread")).toBe(false)
      expect(shadow().querySelector(".launcher")?.getAttribute("title")).toBe("1 open")
   })

   it("marks a thread read when it opens and unread again with u", async () => {
      listed = squawkFixture({ unread: true })
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)
      expect(shadow().querySelector(".item.is-unread")).not.toBeNull()

      click(".item")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({ call: `PUT /squawks/${SQUAWK_ID}/read`, body: undefined })
      expect(shadow().querySelector(".item.is-unread")).toBeNull()

      press("u")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({
         call: `DELETE /squawks/${SQUAWK_ID}/read`,
         body: undefined
      })
      expect(shadow().querySelector(".thread")).toBeNull()
      expect(shadow().querySelector(".item.is-unread")).not.toBeNull()

      // Polling keeps the server's state; the thread stays unread until it is opened again.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(shadow().querySelector(".item.is-unread")).not.toBeNull()
   })

   it("does not mark read squawks read again", async () => {
      await boot()
      press("j")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests().some(request => request.call.endsWith("/read"))).toBe(false)
   })

   it("marks unread from the thread header", async () => {
      await boot()
      press("j")
      await vi.advanceTimersByTimeAsync(0)
      click('.thread [aria-label="Mark as unread (U)"]')
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({
         call: `DELETE /squawks/${SQUAWK_ID}/read`,
         body: undefined
      })
      expect(shadow().querySelector(".thread")).toBeNull()
   })

   it("lists unread squawks under Unread", async () => {
      listed = squawkFixture({ unread: true })
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)
      click(".segment:nth-child(2)")
      expect(text(".segment.is-selected")).toBe("Unread1")
      expect(shadow().querySelectorAll(".item")).toHaveLength(1)

      // Without a pin the thread opens in the panel; back in the list it is read.
      click(".item")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".thread-title")).toBe("#12")
      press("Escape")
      expect(text(".empty")).toContain("All caught up")
   })

   it("shows a working claim and clears it from the thread", async () => {
      listed = squawkFixture({
         working: { by: ADAS_AGENT, since: new Date(Date.now() - 4 * 60_000).toISOString() }
      })
      const squawk = await boot()
      squawk.open()
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".item .working")).toBe("working · 4 min")
      await vi.advanceTimersByTimeAsync(60_000)
      expect(text(".item .working")).toBe("working · 5 min")

      click(".item")
      await vi.advanceTimersByTimeAsync(0)
      expect(text(".thread-banner.is-working")).toContain("Agent · for Ada is working on this")
      click(".thread-banner.is-working .text-button")
      await vi.advanceTimersByTimeAsync(0)
      expect(requests()).toContainEqual({
         call: `DELETE /squawks/${SQUAWK_ID}/working`,
         body: undefined
      })
      expect(shadow().querySelector<HTMLElement>(".thread-banner.is-working")?.hidden).toBe(true)
      expect(shadow().querySelector(".item .working")).toBeNull()
   })
})
