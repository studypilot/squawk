import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "../test-fetch"
import { DevicePage } from "./device"

afterEach(() => {
   vi.unstubAllGlobals()
})

function renderAt(path: string) {
   return render(
      <MemoryRouter initialEntries={[path]}>
         <DevicePage />
      </MemoryRouter>
   )
}

describe("DevicePage", () => {
   it("prefills the code, shows the device and approves it", async () => {
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      const requests = mockFetch({
         "GET /api/auth/device/info": () => ({
            body: { userCode: "WXYZ-1234", kind: "cli", label: "moritz-mbp", expiresAt }
         }),
         "POST /api/auth/device/approve": () => ({ body: {} })
      })
      const user = userEvent.setup()

      renderAt("/device?code=wxyz1234")

      expect((screen.getByRole("textbox", { name: "Code" }) as HTMLInputElement).value).toBe(
         "WXYZ-1234"
      )
      expect(await screen.findByText("moritz-mbp")).toBeTruthy()
      expect(requests[0]?.url).toBe("/api/auth/device/info?userCode=WXYZ-1234")

      await user.click(screen.getByRole("button", { name: "Approve" }))

      expect(await screen.findByText("You can close this tab.")).toBeTruthy()
      expect(requests[1]?.body).toEqual({ userCode: "WXYZ-1234" })
   })

   it("formats typed input and reports unknown codes", async () => {
      mockFetch({})
      const user = userEvent.setup()

      renderAt("/device")
      const input = screen.getByRole("textbox", { name: "Code" })
      await user.type(input, "abcd99")
      expect((input as HTMLInputElement).value).toBe("ABCD-99")
      await user.type(input, "zz")

      expect(await screen.findByText(/unknown or has expired/)).toBeTruthy()
   })
})
