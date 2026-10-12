import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "../components/toast"
import { adaAgent, mockFetch, squawkFixture } from "../test-fetch"
import { SitePage } from "./site"

const unreadSquawk = squawkFixture({
   id: "0b1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e01",
   number: 4,
   body: "Unread one",
   unread: true,
   working: { by: adaAgent, since: new Date(Date.now() - 4 * 60_000).toISOString() }
})
const readSquawk = squawkFixture({
   id: "0b1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e02",
   number: 3,
   body: "Read one"
})

const mainSite = {
   key: "main",
   displayName: null,
   openCount: 2,
   resolvedCount: 0,
   unreadCount: 1,
   lastActivityAt: null,
   createdAt: "2026-10-01T08:00:00.000Z"
}

function renderAt(path: string) {
   return render(
      <ToastProvider>
         <MemoryRouter initialEntries={[path]}>
            <Routes>
               <Route path="/sites/:key" element={<SitePage />} />
            </Routes>
         </MemoryRouter>
      </ToastProvider>
   )
}

afterEach(() => {
   vi.unstubAllGlobals()
})

describe("SitePage", () => {
   it("marks unread rows and shows which squawks an agent is working on", async () => {
      mockFetch({
         "GET /api/sites": () => ({ body: { items: [mainSite] } }),
         "GET /api/squawks": () => ({
            body: { items: [unreadSquawk, readSquawk], nextCursor: null }
         })
      })

      renderAt("/sites/main")

      const unreadRow = (await screen.findByText("Unread one")).closest("a")!
      const readRow = screen.getByText("Read one").closest("a")!
      expect(unreadRow.className).toContain("squawk-row-unread")
      expect(within(unreadRow).getByTitle("Unread")).toBeTruthy()
      expect(within(unreadRow).getByText("working · 4 min")).toBeTruthy()
      expect(readRow.className).not.toContain("squawk-row-unread")
      expect(within(readRow).queryByText(/working/)).toBeNull()
   })

   it("filters to unread squawks with the Unread chip", async () => {
      const requests = mockFetch({
         "GET /api/sites": () => ({ body: { items: [mainSite] } }),
         "GET /api/squawks": () => ({ body: { items: [unreadSquawk], nextCursor: null } })
      })
      const user = userEvent.setup()

      renderAt("/sites/main")
      await screen.findByText("Unread one")
      const chip = screen.getByRole("button", { name: /Unread/ })
      expect(chip.getAttribute("aria-pressed")).toBe("false")
      await user.click(chip)

      expect(chip.getAttribute("aria-pressed")).toBe("true")
      const lists = requests.filter(request => request.url.startsWith("/api/squawks?"))
      expect(lists.at(0)?.url).toBe("/api/squawks?site=main&status=open")
      expect(lists.at(-1)?.url).toBe("/api/squawks?site=main&status=open&unread=true")
   })

   it("toggles read and unread with u", async () => {
      const requests = mockFetch({
         "GET /api/sites": () => ({ body: { items: [mainSite] } }),
         "GET /api/squawks": () => ({
            body: { items: [unreadSquawk, readSquawk], nextCursor: null }
         }),
         [`PUT /api/squawks/${unreadSquawk.id}/read`]: () => ({ status: 204 }),
         [`DELETE /api/squawks/${readSquawk.id}/read`]: () => ({ status: 204 })
      })
      // jsdom has neither; the page scrolls the selected row into view.
      vi.stubGlobal("CSS", { escape: (value: string) => value })
      Element.prototype.scrollIntoView = vi.fn()
      const user = userEvent.setup()

      renderAt("/sites/main")
      await screen.findByText("Unread one")
      await user.keyboard("ju")
      expect(await screen.findByText("Marked #4 as read")).toBeTruthy()
      await user.keyboard("ju")
      expect(await screen.findByText("Marked #3 as unread")).toBeTruthy()

      const writes = requests.filter(request => request.method !== "GET")
      expect(writes.map(request => `${request.method} ${request.url}`)).toEqual([
         `PUT /api/squawks/${unreadSquawk.id}/read`,
         `DELETE /api/squawks/${readSquawk.id}/read`
      ])
   })
})
