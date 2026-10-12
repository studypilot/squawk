import { describe, expect, it, vi } from "vitest"
import type { Squawk } from "@squawk/shared"
import type { OverlayState } from "../state"
import { ADA, ADAS_AGENT, draftFixture, squawkFixture } from "../test-fixtures"
import { createPanel } from "./panel"
import type { PanelHandlers } from "./panel"

function handlers(): PanelHandlers {
   return {
      close: vi.fn(),
      startPinMode: vi.fn(),
      setFilter: vi.fn(),
      openThread: vi.fn(),
      hoverSquawk: vi.fn(),
      revealDraft: vi.fn(),
      signIn: vi.fn(),
      signInWithCode: vi.fn(),
      cancelSignIn: vi.fn(),
      signOut: vi.fn(),
      updateDraft: vi.fn(async () => undefined),
      deleteDraft: vi.fn(async () => undefined),
      submitReview: vi.fn(async () => undefined)
   }
}

function listState(squawks: Squawk[], overrides: Partial<OverlayState> = {}): OverlayState {
   return {
      siteKey: "feature/foo",
      pageKey: "/",
      pageKeyOverridden: false,
      meta: {},
      token: "sqk_secret",
      squawks,
      drafts: [],
      me: null,
      panel: "list",
      threadId: null,
      thread: null,
      login: null,
      filter: "open",
      mode: "idle",
      extensionAvailable: false,
      ...overrides
   }
}

function render(state: OverlayState, panelHandlers = handlers()): HTMLElement {
   const panel = createPanel(panelHandlers)
   panel.setLoaded(true)
   panel.render(state, null)
   return panel.element
}

describe("squawk list", () => {
   it("shows the list row preview as plain text", () => {
      const body = "# Title\n\n**Bold** <img src=x onerror=alert(1)>"
      const element = render(listState([squawkFixture({ body })]))
      expect(element.querySelector(".item-body")?.textContent).toBe("Title")
   })

   it("groups by page with this page first and filters by status", () => {
      const element = render(
         listState([
            squawkFixture({ id: crypto.randomUUID(), number: 1, page: "/pricing" }),
            squawkFixture({ id: crypto.randomUUID(), number: 2 }),
            squawkFixture({ id: crypto.randomUUID(), number: 3, status: "resolved" })
         ])
      )
      const titles = [...element.querySelectorAll(".group-title")].map(title => title.textContent)
      expect(titles).toEqual(["This page1", "/pricing1"])
      expect(element.querySelector(".segment.is-selected")?.textContent).toBe("Open2")
      expect(element.querySelectorAll(".item")).toHaveLength(2)
   })

   it("asks for the first squawk when the list is empty", () => {
      const element = render(listState([]))
      expect(element.querySelector(".empty")?.textContent).toContain(
         "Press C or click + to leave the first squawk"
      )
   })

   it("marks the open thread's row and scrolls it into view", () => {
      // jsdom has no layout, so no scrollIntoView either.
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const squawk = squawkFixture()
      const element = render(listState([squawk], { threadId: squawk.id }))
      expect(element.querySelector(".item")?.classList.contains("is-selected")).toBe(true)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
   })
})

describe("agent authors", () => {
   it("shows an agent writing for a user as the agent, not as the user", () => {
      const element = render(
         listState([squawkFixture({ author: ADAS_AGENT, lastAuthor: ADAS_AGENT })])
      )
      const name = element.querySelector(".item-head .name")
      expect(name?.textContent).toBe("Agent · for Ada")
      expect(name?.getAttribute("title")).toBe("CLI MiniMo.local")
      const avatars = element.querySelectorAll(".item .avatar")
      expect(avatars).toHaveLength(1)
      expect(avatars[0]?.classList.contains("is-agent")).toBe(true)
      expect(avatars[0]?.textContent).toBe("")
   })

   it("stacks the user and the agent that replied", () => {
      const element = render(listState([squawkFixture({ author: ADA, lastAuthor: ADAS_AGENT })]))
      const avatars = [...element.querySelectorAll(".item .avatar")]
      expect(avatars.map(avatar => avatar.classList.contains("is-agent"))).toEqual([false, true])
      expect(element.querySelector(".item-head .name")?.textContent).toBe("Ada Lovelace")
   })

   it("falls back to the email local part without a name", () => {
      const author = { ...ADAS_AGENT, name: null, email: "grace@example.com" }
      const element = render(listState([squawkFixture({ author })]))
      expect(element.querySelector(".item-head .name")?.textContent).toBe("Agent · for grace")
   })
})

describe("review block", () => {
   it("lists drafts and submits them", () => {
      const panelHandlers = handlers()
      const element = render(
         listState([], {
            drafts: [
               draftFixture(),
               draftFixture({ id: crypto.randomUUID(), number: 14, page: "/x" })
            ]
         }),
         panelHandlers
      )
      expect(element.querySelectorAll(".draft")).toHaveLength(2)
      expect(element.querySelector(".draft-page")?.textContent).toBe("/x")
      element.querySelector<HTMLButtonElement>(".submit-review")?.click()
      expect(panelHandlers.submitReview).toHaveBeenCalledOnce()
   })

   it("shows a failed submit inline", async () => {
      const panelHandlers = handlers()
      panelHandlers.submitReview = vi.fn(async () => {
         throw new Error("Server down")
      })
      const element = render(listState([], { drafts: [draftFixture()] }), panelHandlers)
      const submit = element.querySelector<HTMLButtonElement>(".submit-review")
      submit?.click()
      await vi.waitFor(() =>
         expect(element.querySelector(".review .error")?.textContent).toBe("Server down")
      )
      expect(submit?.disabled).toBe(false)
   })

   it("keeps an open editor across re-renders", () => {
      const panel = createPanel(handlers())
      const draft = draftFixture()
      const state = listState([], { drafts: [draft] })
      panel.render(state, null)
      panel.editDraft(draft.id)
      const textarea = panel.element.querySelector<HTMLTextAreaElement>(".draft textarea")
      if (!textarea) throw new Error("editor not open")
      textarea.value = "typing…"
      panel.render({ ...state, squawks: [squawkFixture()] }, null)
      expect(panel.element.querySelector<HTMLTextAreaElement>(".draft textarea")?.value).toBe(
         "typing…"
      )
   })
})

describe("panel chrome", () => {
   it("has no Markdown hint anywhere", () => {
      const element = render(listState([squawkFixture()]))
      expect(element.textContent).not.toContain("Markdown")
   })

   it("shows the account and signs out", () => {
      const panelHandlers = handlers()
      const element = render(listState([], { me: { principal: ADA, token: null } }), panelHandlers)
      expect(element.querySelector(".account .name")?.textContent).toBe("Ada Lovelace")
      element.querySelector<HTMLButtonElement>(".panel-footer .text-button")?.click()
      expect(panelHandlers.signOut).toHaveBeenCalledOnce()
   })
})
