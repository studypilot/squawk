import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { browserLocation } from "../api/client"
import { mockFetch, userAuthor } from "../test-fetch"
import { connectWindow, ConnectPage } from "./connect"

const ORIGIN = "https://preview.example.com"
const me = { principal: userAuthor, token: null }

let opener: { closed: boolean; postMessage: ReturnType<typeof vi.fn> }
let close: ReturnType<typeof vi.spyOn>

beforeEach(() => {
   opener = { closed: false, postMessage: vi.fn() }
   vi.spyOn(connectWindow, "opener").mockReturnValue(opener as unknown as Window)
   close = vi.spyOn(connectWindow, "close").mockImplementation(() => undefined)
})

afterEach(() => {
   vi.restoreAllMocks()
   vi.unstubAllGlobals()
})

function renderAt(origin: string) {
   return render(
      <MemoryRouter initialEntries={[`/connect?origin=${encodeURIComponent(origin)}`]}>
         <ConnectPage />
      </MemoryRouter>
   )
}

describe("ConnectPage", () => {
   it("asks before connecting an untrusted site and posts the token to its origin only", async () => {
      const requests = mockFetch({
         "GET /api/me": () => ({ body: me }),
         "GET /api/auth/connect": () => ({ body: { origin: ORIGIN, trusted: false } }),
         "POST /api/auth/connect": () => ({ body: { token: "sqk_popup", user: userAuthor } })
      })
      const user = userEvent.setup()

      renderAt(ORIGIN)

      expect(await screen.findByRole("heading", { name: "Connect this site" })).toBeTruthy()
      expect(screen.getByText(ORIGIN)).toBeTruthy()
      expect(screen.getByText("ada@example.com")).toBeTruthy()
      expect(requests[1]?.url).toBe("/api/auth/connect?origin=https%3A%2F%2Fpreview.example.com")
      expect(opener.postMessage).not.toHaveBeenCalled()

      await user.click(screen.getByRole("button", { name: "Allow" }))

      expect(await screen.findByText("You can close this window.")).toBeTruthy()
      expect(requests[2]?.body).toEqual({
         origin: ORIGIN,
         label: "Overlay on preview.example.com"
      })
      expect(opener.postMessage).toHaveBeenCalledWith(
         { type: "squawk:connect", status: "ok", token: "sqk_popup" },
         ORIGIN
      )
      expect(close).toHaveBeenCalled()
   })

   it("connects a trusted site without asking, exactly once", async () => {
      const requests = mockFetch({
         "GET /api/me": () => ({ body: me }),
         "GET /api/auth/connect": () => ({ body: { origin: ORIGIN, trusted: true } }),
         "POST /api/auth/connect": () => ({ body: { token: "sqk_trusted", user: userAuthor } })
      })

      renderAt(ORIGIN)

      expect(await screen.findByText("You can close this window.")).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Allow" })).toBeNull()
      expect(requests.filter(request => request.method === "POST")).toHaveLength(1)
      expect(opener.postMessage).toHaveBeenCalledWith(
         { type: "squawk:connect", status: "ok", token: "sqk_trusted" },
         ORIGIN
      )
   })

   it("reports a cancellation to the opener", async () => {
      mockFetch({
         "GET /api/me": () => ({ body: me }),
         "GET /api/auth/connect": () => ({ body: { origin: ORIGIN, trusted: false } })
      })
      const user = userEvent.setup()

      renderAt(ORIGIN)
      await user.click(await screen.findByRole("button", { name: "Cancel" }))

      expect(opener.postMessage).toHaveBeenCalledWith(
         { type: "squawk:connect", status: "cancelled" },
         ORIGIN
      )
      expect(close).toHaveBeenCalled()
   })

   it("sends signed-out visitors to sign in and back", async () => {
      mockFetch({ "GET /api/me": () => ({ status: 401, body: {} }) })
      vi.spyOn(browserLocation, "currentPath").mockReturnValue(
         "/connect?origin=https%3A%2F%2Fpreview.example.com"
      )
      const navigate = vi.spyOn(browserLocation, "navigate").mockImplementation(() => undefined)

      renderAt(ORIGIN)

      await vi.waitFor(() =>
         expect(navigate).toHaveBeenCalledWith(
            "/auth/login?returnTo=%2Fconnect%3Forigin%3Dhttps%253A%252F%252Fpreview.example.com"
         )
      )
      expect(opener.postMessage).not.toHaveBeenCalled()
   })

   it.each(["", "preview.example.com", "https://preview.example.com/path", "javascript:alert(1)"])(
      "refuses the origin %j",
      origin => {
         const requests = mockFetch({})
         renderAt(origin)
         expect(screen.getByRole("heading", { name: "Cannot connect" })).toBeTruthy()
         expect(requests).toHaveLength(0)
      }
   )

   it("needs the overlay as its opener", () => {
      vi.spyOn(connectWindow, "opener").mockReturnValue(null)
      const requests = mockFetch({})
      renderAt(ORIGIN)
      expect(screen.getByText("Open this page from the Squawk overlay.")).toBeTruthy()
      expect(requests).toHaveLength(0)
   })
})
