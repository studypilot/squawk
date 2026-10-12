import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "../test-fetch"
import { SitesPage } from "./sites"

function site(
   key: string,
   lastActivityAt: string | null,
   displayName: string | null = null,
   unreadCount = 0
) {
   return {
      key,
      displayName,
      openCount: 3,
      resolvedCount: 1,
      unreadCount,
      lastActivityAt,
      createdAt: "2026-10-01T08:00:00.000Z"
   }
}

function renderPage() {
   return render(
      <MemoryRouter>
         <SitesPage />
      </MemoryRouter>
   )
}

afterEach(() => {
   vi.unstubAllGlobals()
})

describe("SitesPage", () => {
   it("lists sites sorted by last activity, newest first", async () => {
      mockFetch({
         "GET /api/sites": () => ({
            body: {
               items: [
                  site("older", "2026-10-02T08:00:00.000Z"),
                  site("idle", null),
                  site("feature-x", "2026-10-09T08:00:00.000Z", "Feature X")
               ]
            }
         })
      })

      renderPage()

      const rows = await screen.findAllByRole("row")
      const keys = rows.slice(1).map(row => within(row).getAllByRole("cell")[0]?.textContent)
      expect(keys).toEqual(["feature-x", "older", "idle"])
      expect(screen.getByText("Feature X")).toBeTruthy()
      expect(screen.getByRole("link", { name: "feature-x" }).getAttribute("href")).toBe(
         "/sites/feature-x"
      )
   })

   it("links unread counts to the unread filter of the site", async () => {
      mockFetch({
         "GET /api/sites": () => ({
            body: { items: [site("feature-x", null, null, 2), site("quiet", null)] }
         })
      })

      renderPage()

      const badge = await screen.findByRole("link", { name: "2 unread" })
      expect(badge.getAttribute("href")).toBe("/sites/feature-x?unread=1")
      expect(screen.queryAllByText(/unread/)).toHaveLength(1)
   })

   it("saves an edited display name with PATCH", async () => {
      const requests = mockFetch({
         "GET /api/sites": () => ({ body: { items: [site("main", null)] } }),
         "PATCH /api/sites/main": () => ({ body: site("main", null, "Main branch") })
      })
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole("button", { name: "Edit display name of main" }))
      await user.type(screen.getByRole("textbox", { name: "Display name of main" }), "Main branch")
      await user.click(screen.getByRole("button", { name: "Save" }))

      expect(await screen.findByText("Main branch")).toBeTruthy()
      const patch = requests.find(request => request.method === "PATCH")
      expect(patch?.body).toEqual({ displayName: "Main branch" })
      expect(patch?.headers["Content-Type"]).toBe("application/json")
   })

   it("explains how to embed the script when there are no sites", async () => {
      mockFetch({ "GET /api/sites": () => ({ body: { items: [] } }) })

      renderPage()

      expect(await screen.findByText("No sites yet")).toBeTruthy()
      expect(
         screen.getByText(
            `<script src="${window.location.origin}/squawk.js" data-site="my-branch" defer></script>`
         )
      ).toBeTruthy()
   })
})
