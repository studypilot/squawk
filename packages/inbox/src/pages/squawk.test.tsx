import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "../components/toast"
import { adaAgent, mockFetch, squawkFixture } from "../test-fetch"
import { SquawkPage } from "./squawk"

const squawkId = "2b1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e6f"
const detailRoute = `GET /api/squawks/${squawkId}`

function renderPage() {
   return render(
      <ToastProvider>
         <MemoryRouter initialEntries={[`/squawks/${squawkId}`]}>
            <Routes>
               <Route path="/squawks/:id" element={<SquawkPage />} />
               <Route path="/sites/:key" element={<p>Site list</p>} />
            </Routes>
         </MemoryRouter>
      </ToastProvider>
   )
}

afterEach(() => {
   vi.unstubAllGlobals()
})

describe("SquawkPage", () => {
   it("marks an unread squawk read once it is shown", async () => {
      const requests = mockFetch({
         [detailRoute]: () => ({ body: squawkFixture({ unread: true }) }),
         [`PUT /api/squawks/${squawkId}/read`]: () => ({ status: 204 })
      })

      renderPage()

      expect(await screen.findByRole("heading", { name: /save button/ })).toBeTruthy()
      await vi.waitFor(() =>
         expect(requests.map(request => request.method)).toEqual(["GET", "PUT"])
      )
   })

   it("does not write anything for a squawk that is already read", async () => {
      const requests = mockFetch({ [detailRoute]: () => ({ body: squawkFixture() }) })

      renderPage()

      await screen.findByRole("heading", { name: /save button/ })
      expect(requests.map(request => request.method)).toEqual(["GET"])
   })

   it("marks it unread and goes back to the site", async () => {
      const requests = mockFetch({
         [detailRoute]: () => ({ body: squawkFixture() }),
         [`DELETE /api/squawks/${squawkId}/read`]: () => ({ status: 204 })
      })
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole("button", { name: "Mark as unread" }))

      expect(await screen.findByText("Site list")).toBeTruthy()
      expect(screen.getByText("Marked #3 as unread")).toBeTruthy()
      expect(requests.at(-1)).toMatchObject({ method: "DELETE" })
   })

   it("shows who is working on it and clears the claim", async () => {
      let working: unknown = {
         by: adaAgent,
         since: new Date(Date.now() - 4 * 60_000).toISOString()
      }
      const requests = mockFetch({
         [detailRoute]: () => ({ body: squawkFixture({ working }) }),
         [`DELETE /api/squawks/${squawkId}/working`]: () => {
            working = null
            return { status: 204 }
         }
      })
      const user = userEvent.setup()

      renderPage()

      const banner = (await screen.findByText(/is working on this/)).closest(".working-banner")
      expect(banner?.textContent).toBe("Agent · for Ada is working on this · since 4 minClear")
      await user.click(screen.getByRole("button", { name: "Clear" }))

      await vi.waitFor(() => expect(screen.queryByText(/is working on this/)).toBeNull())
      expect(requests.some(request => request.method === "DELETE")).toBe(true)
   })
})
