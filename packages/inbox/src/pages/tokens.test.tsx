import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch, userAuthor } from "../test-fetch"
import { TokensPage } from "./tokens"

const secret = "sqk_abcdefghijklmnopqrstuvwxyz012345"

const createdToken = {
   id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
   name: "claude on feature-x",
   prefix: "sqk_abcdefgh",
   kind: "agent" as const,
   siteKey: "feature-x",
   createdBy: userAuthor,
   createdAt: "2026-10-10T10:00:00.000Z",
   expiresAt: null,
   revokedAt: null,
   lastUsedAt: null
}

afterEach(() => {
   vi.unstubAllGlobals()
})

describe("TokensPage", () => {
   it("creates an agent token and shows the secret exactly once", async () => {
      let created = false
      const requests = mockFetch({
         "GET /api/tokens": () => ({ body: { items: created ? [createdToken] : [] } }),
         "POST /api/tokens": () => {
            created = true
            return { status: 201, body: { token: createdToken, secret } }
         }
      })
      const user = userEvent.setup()

      render(
         <MemoryRouter>
            <TokensPage />
         </MemoryRouter>
      )
      expect(await screen.findByText("No tokens yet.")).toBeTruthy()

      await user.type(screen.getByRole("textbox", { name: "Name" }), "claude on feature-x")
      await user.type(screen.getByRole("textbox", { name: /Site key/ }), "feature-x")
      await user.type(screen.getByRole("spinbutton", { name: /Expires after days/ }), "30")
      await user.click(screen.getByRole("button", { name: "Create token" }))

      const secretBox = await screen.findByRole("textbox", { name: "New token" })
      expect((secretBox as HTMLInputElement).value).toBe(secret)
      expect(screen.getByText("Copy this token now. It will not be shown again.")).toBeTruthy()
      expect(await screen.findByText("claude on feature-x")).toBeTruthy()

      const post = requests.find(request => request.method === "POST")
      expect(post?.body).toEqual({
         name: "claude on feature-x",
         siteKey: "feature-x",
         expiresInDays: 30
      })
      expect(post?.headers["Content-Type"]).toBe("application/json")

      await user.click(screen.getByRole("button", { name: "Done" }))
      expect(screen.queryByRole("textbox", { name: "New token" })).toBeNull()
      expect(document.body.textContent).not.toContain(secret)
   })

   it("sends null for empty optional fields", async () => {
      const requests = mockFetch({
         "GET /api/tokens": () => ({ body: { items: [] } }),
         "POST /api/tokens": () => ({
            status: 201,
            body: { token: { ...createdToken, siteKey: null }, secret }
         })
      })
      const user = userEvent.setup()

      render(
         <MemoryRouter>
            <TokensPage />
         </MemoryRouter>
      )
      await user.type(await screen.findByRole("textbox", { name: "Name" }), "ci agent")
      await user.click(screen.getByRole("button", { name: "Create token" }))

      await screen.findByRole("textbox", { name: "New token" })
      expect(requests.find(request => request.method === "POST")?.body).toEqual({
         name: "ci agent",
         siteKey: null,
         expiresInDays: null
      })
   })
})
