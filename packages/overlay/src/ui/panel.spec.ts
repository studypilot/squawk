import { describe, expect, it, vi } from "vitest"
import type { SquawkDetail } from "@squawk/shared"
import type { OverlayState } from "../state"
import { SQUAWK_ID, squawkFixture } from "../test-fixtures"
import { createPanel } from "./panel"
import type { PanelHandlers } from "./panel"

function handlers(): PanelHandlers {
   return {
      close: vi.fn(),
      startPinMode: vi.fn(),
      setFilter: vi.fn(),
      openThread: vi.fn(),
      showList: vi.fn(),
      signIn: vi.fn(),
      cancelSignIn: vi.fn(),
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
      panel: "thread",
      threadId: thread.id,
      thread,
      login: null,
      filter: "open",
      mode: "idle",
      extensionAvailable: false
   }
}

function renderThread(url: string | undefined): HTMLAnchorElement {
   const panel = createPanel(handlers())
   const thread: SquawkDetail = {
      ...squawkFixture({ id: SQUAWK_ID, page: "/other", meta: url === undefined ? {} : { url } }),
      comments: []
   }
   panel.render(threadState(thread))
   const link = panel.element.querySelector<HTMLAnchorElement>(".thread-actions a")
   if (!link) throw new Error("page link not rendered")
   return link
}

describe("thread page link", () => {
   it("links to http(s) page URLs of other pages", () => {
      const link = renderThread("https://preview.example.com/other?x=1")
      expect(link.hidden).toBe(false)
      expect(link.getAttribute("href")).toBe("https://preview.example.com/other?x=1")
   })

   it.each(["javascript:alert(1)", "data:text/html,hi", "not a url", "file:///etc/passwd"])(
      "hides the link for %s",
      url => {
         const link = renderThread(url)
         expect(link.hidden).toBe(true)
         expect(link.hasAttribute("href")).toBe(false)
      }
   )

   it("hides the link when the squawk carries no URL", () => {
      expect(renderThread(undefined).hidden).toBe(true)
   })
})
