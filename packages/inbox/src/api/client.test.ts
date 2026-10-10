import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "../test-fetch"
import { ApiError, browserLocation, getMe, revokeToken, updateSquawkStatus } from "./client"

afterEach(() => {
   vi.unstubAllGlobals()
   vi.restoreAllMocks()
})

describe("api client", () => {
   it("redirects to the login page with the current path on 401", async () => {
      mockFetch({
         "GET /api/me": () => ({
            status: 401,
            body: { error: { code: "unauthorized", message: "Sign in" } }
         })
      })
      vi.spyOn(browserLocation, "currentPath").mockReturnValue("/sites/main?status=all")
      const navigate = vi.spyOn(browserLocation, "navigate").mockImplementation(() => {})

      await expect(getMe()).rejects.toBeInstanceOf(ApiError)
      expect(navigate).toHaveBeenCalledWith(
         `/auth/login?returnTo=${encodeURIComponent("/sites/main?status=all")}`
      )
   })

   it("sends cookies and JSON content type on state-changing requests", async () => {
      const requests = mockFetch({
         "PATCH /api/squawks/abc": () => ({ body: {} }),
         "DELETE /api/tokens/t1": () => ({ status: 204 })
      })

      await updateSquawkStatus("abc", "resolved")
      await revokeToken("t1")

      expect(requests.map(request => request.headers["Content-Type"])).toEqual([
         "application/json",
         "application/json"
      ])
      expect(requests[0]?.body).toEqual({ status: "resolved" })
      const fetchMock = vi.mocked(fetch)
      expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include")
   })

   it("turns error envelopes into ApiError", async () => {
      mockFetch({
         "GET /api/me": () => ({
            status: 403,
            body: { error: { code: "forbidden", message: "Agents cannot do that" } }
         })
      })

      const error = await getMe().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe("forbidden")
      expect((error as ApiError).message).toBe("Agents cannot do that")
   })
})
