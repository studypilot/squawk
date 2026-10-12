import { describe, expect, it, vi } from "vitest"
import type { SquawkDetail } from "@squawk/shared"
import type { OverlayState } from "../state"
import { ADA, ADAS_AGENT, SQUAWK_ID, squawkFixture } from "../test-fixtures"
import { createThreadView } from "./thread"
import type { ThreadHandlers } from "./thread"

function handlers(): ThreadHandlers {
   return {
      close: vi.fn(),
      reply: vi.fn(async () => undefined),
      setStatus: vi.fn(async () => undefined),
      copyLink: vi.fn(),
      loadScreenshot: vi.fn(async () => new Blob())
   }
}

function threadState(thread: SquawkDetail): OverlayState {
   return {
      siteKey: "feature/foo",
      pageKey: "/",
      pageKeyOverridden: false,
      meta: {},
      token: "sqk_secret",
      squawks: [thread],
      drafts: [],
      me: null,
      panel: "thread",
      threadId: thread.id,
      thread,
      login: null,
      filter: "open",
      mode: "idle",
      extensionAvailable: false
   }
}

function renderThread(thread: SquawkDetail, threadHandlers = handlers()): HTMLElement {
   const view = createThreadView(thread.id, threadHandlers)
   view.update(threadState(thread), "popover")
   return view.element
}

function pageLink(url: string | undefined): HTMLAnchorElement {
   const element = renderThread({
      ...squawkFixture({ id: SQUAWK_ID, page: "/other", meta: url === undefined ? {} : { url } }),
      comments: []
   })
   const link = element.querySelector<HTMLAnchorElement>(".thread-header a")
   if (!link) throw new Error("page link not rendered")
   return link
}

describe("thread page link", () => {
   it("links to http(s) page URLs of other pages", () => {
      const link = pageLink("https://preview.example.com/other?x=1")
      expect(link.hidden).toBe(false)
      expect(link.getAttribute("href")).toBe("https://preview.example.com/other?x=1")
   })

   it.each(["javascript:alert(1)", "data:text/html,hi", "not a url", "file:///etc/passwd"])(
      "hides the link for %s",
      url => {
         const link = pageLink(url)
         expect(link.hidden).toBe(true)
         expect(link.hasAttribute("href")).toBe(false)
      }
   )

   it("hides the link when the squawk carries no URL", () => {
      expect(pageLink(undefined).hidden).toBe(true)
   })
})

describe("thread messages", () => {
   it("renders bodies as escaped Markdown", () => {
      const body = "# Title\n\n**Bold** <img src=x onerror=alert(1)> [x](javascript:alert(1))"
      const element = renderThread({ ...squawkFixture({ body }), comments: [] })
      const message = element.querySelector(".message-body.markdown")
      expect(message?.querySelector("h1")?.textContent).toBe("Title")
      expect(message?.querySelector("strong")?.textContent).toBe("Bold")
      expect(message?.querySelector("img, a")).toBeNull()
      expect(message?.textContent).toContain("<img src=x onerror=alert(1)>")
   })

   it("labels agent replies and agent resolutions as the agent", () => {
      const element = renderThread({
         ...squawkFixture({
            status: "resolved",
            resolvedBy: ADAS_AGENT,
            resolvedAt: "2026-10-10T13:00:00.000Z"
         }),
         comments: [
            {
               id: crypto.randomUUID(),
               squawkId: SQUAWK_ID,
               body: "Fixed in a1b2c3d",
               author: ADAS_AGENT,
               createdAt: "2026-10-10T13:00:00.000Z"
            }
         ]
      })
      const names = [...element.querySelectorAll(".message-head .name")].map(
         name => name.textContent
      )
      expect(names).toEqual([ADA.name, "Agent · for Ada"])
      expect(element.querySelectorAll(".message.is-agent")).toHaveLength(1)
      expect(element.querySelector(".thread-banner")?.textContent).toContain(
         "Resolved by Agent · for Ada"
      )
      expect(element.textContent).not.toContain("Markdown")
   })
})

describe("reply field", () => {
   function setup() {
      const threadHandlers = handlers()
      const element = renderThread({ ...squawkFixture(), comments: [] }, threadHandlers)
      const textarea = element.querySelector("textarea")
      if (!textarea) throw new Error("reply field missing")
      const press = (init: KeyboardEventInit): void => {
         textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ...init }))
      }
      return { threadHandlers, element, textarea, press }
   }

   it("sends with Enter and with Cmd+Enter, but not with Shift+Enter", async () => {
      const { threadHandlers, textarea, press } = setup()
      textarea.value = "Line"
      press({ shiftKey: true })
      expect(threadHandlers.reply).not.toHaveBeenCalled()

      press({})
      await vi.waitFor(() => expect(threadHandlers.reply).toHaveBeenCalledWith(SQUAWK_ID, "Line"))
      await vi.waitFor(() => expect(textarea.value).toBe(""))

      textarea.value = "Again"
      press({ metaKey: true })
      await vi.waitFor(() => expect(threadHandlers.reply).toHaveBeenCalledTimes(2))
   })

   it("shows a failed reply inline and keeps the text", async () => {
      const { threadHandlers, element, textarea, press } = setup()
      threadHandlers.reply = vi.fn(async () => {
         throw new Error("Server down")
      })
      textarea.value = "Keep me"
      press({})
      await vi.waitFor(() =>
         expect(element.querySelector(".error")?.textContent).toBe("Server down")
      )
      expect(textarea.value).toBe("Keep me")
      expect(textarea.disabled).toBe(false)
   })

   it("resolves from the header", () => {
      const { threadHandlers, element } = setup()
      element.querySelector<HTMLButtonElement>(".resolve")?.click()
      expect(threadHandlers.setStatus).toHaveBeenCalledWith(SQUAWK_ID, "resolved")
   })
})
