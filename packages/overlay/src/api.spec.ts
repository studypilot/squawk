import { describe, expect, it, vi } from "vitest"
import { ApiError, createApiClient } from "./api"
import { SQUAWK_ID, squawkFixture } from "./test-fixtures"

function jsonResponse(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
   })
}

function setup(token: string | null = "sqk_secret") {
   const fetchImplementation = vi.fn<typeof fetch>()
   const onUnauthorized = vi.fn()
   const api = createApiClient({
      serverOrigin: "https://squawk.test",
      getToken: () => token,
      onUnauthorized,
      fetchImplementation
   })
   const lastRequest = (): { url: string; init: RequestInit } => {
      const [url, init] = fetchImplementation.mock.lastCall ?? []
      return { url: String(url), init: init ?? {} }
   }
   return { api, fetchImplementation, onUnauthorized, lastRequest }
}

describe("api client", () => {
   it("lists squawks with bearer auth and without cookies", async () => {
      const { api, fetchImplementation, lastRequest } = setup()
      fetchImplementation.mockResolvedValue(
         jsonResponse({ items: [squawkFixture()], nextCursor: null })
      )

      const result = await api.listSquawks({ site: "feature/foo", status: "all", limit: 200 })

      expect(result.items[0]?.number).toBe(12)
      const { url, init } = lastRequest()
      expect(url).toBe("https://squawk.test/api/squawks?site=feature%2Ffoo&status=all&limit=200")
      expect(init.credentials).toBe("omit")
      expect(init.headers).toEqual({ Authorization: "Bearer sqk_secret" })
   })

   it("posts a squawk as multipart with the json part and the screenshot", async () => {
      const { api, fetchImplementation, lastRequest } = setup()
      fetchImplementation.mockResolvedValue(jsonResponse(squawkFixture(), 201))
      const screenshot = new Blob(["png"], { type: "image/png" })

      await api.createSquawk(
         { siteKey: "feature/foo", page: "/", body: "Hi", anchor: null, meta: {} },
         screenshot
      )

      const { url, init } = lastRequest()
      expect(url).toBe("https://squawk.test/api/squawks")
      expect(init.method).toBe("POST")
      const form = init.body as FormData
      expect(JSON.parse(String(form.get("squawk")))).toMatchObject({ siteKey: "feature/foo" })
      expect(form.get("screenshot")).toBeInstanceOf(Blob)
      expect(init.headers).toEqual({ Authorization: "Bearer sqk_secret" })
   })

   it("sends json bodies for comments and status changes", async () => {
      const { api, fetchImplementation, lastRequest } = setup()
      fetchImplementation.mockResolvedValue(jsonResponse(squawkFixture({ status: "resolved" })))

      await api.setStatus(SQUAWK_ID, "resolved")

      const { url, init } = lastRequest()
      expect(url).toBe(`https://squawk.test/api/squawks/${SQUAWK_ID}`)
      expect(init.method).toBe("PATCH")
      expect(init.body).toBe('{"status":"resolved"}')
      expect(init.headers).toMatchObject({ "Content-Type": "application/json" })
   })

   it("reports 401 and throws an unauthorized error", async () => {
      const { api, fetchImplementation, onUnauthorized } = setup()
      fetchImplementation.mockResolvedValue(
         jsonResponse({ error: { code: "unauthorized", message: "Token revoked" } }, 401)
      )

      const failure = api.me()

      await expect(failure).rejects.toMatchObject({ status: 401, code: "unauthorized" })
      expect(onUnauthorized).toHaveBeenCalledOnce()
   })

   it("maps error bodies and network failures to ApiError", async () => {
      const { api, fetchImplementation, onUnauthorized } = setup()
      fetchImplementation.mockResolvedValueOnce(
         jsonResponse({ error: { code: "not_found", message: "No such squawk" } }, 404)
      )
      await expect(api.getSquawk(SQUAWK_ID)).rejects.toEqual(
         new ApiError(404, "not_found", "No such squawk")
      )

      fetchImplementation.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      await expect(api.getSquawk(SQUAWK_ID)).rejects.toMatchObject({ code: "network" })
      expect(onUnauthorized).not.toHaveBeenCalled()
   })

   it("calls the device endpoints without a token", async () => {
      const { api, fetchImplementation, lastRequest } = setup()
      fetchImplementation.mockResolvedValue(
         jsonResponse({
            deviceCode: "device",
            userCode: "WXYZ-1234",
            verificationUrl: "https://squawk.test/device?code=WXYZ-1234",
            expiresIn: 600,
            interval: 3
         })
      )

      await api.startDeviceLogin("https://preview.test")

      const { url, init } = lastRequest()
      expect(url).toBe("https://squawk.test/api/auth/device")
      expect(init.headers).toEqual({ "Content-Type": "application/json" })
      expect(JSON.parse(String(init.body))).toEqual({
         kind: "overlay",
         label: "https://preview.test"
      })
   })

   it("does not treat a 401 from the device endpoints as a lost session", async () => {
      const { api, fetchImplementation, onUnauthorized } = setup()
      fetchImplementation.mockResolvedValue(jsonResponse({}, 401))
      await expect(api.pollDeviceLogin("device")).rejects.toBeInstanceOf(ApiError)
      expect(onUnauthorized).not.toHaveBeenCalled()
   })

   it("fetches screenshots through the api prefix with the token", async () => {
      const { api, fetchImplementation, lastRequest } = setup()
      fetchImplementation.mockResolvedValue(new Response("png"))

      const blob = await api.fetchScreenshot(`/api/screenshots/${SQUAWK_ID}`)

      expect(blob.size).toBe(3)
      expect(lastRequest().url).toBe(`https://squawk.test/api/screenshots/${SQUAWK_ID}`)
      expect(lastRequest().init.headers).toEqual({ Authorization: "Bearer sqk_secret" })
   })

   it("validates responses against the contract in dev builds", async () => {
      const { api, fetchImplementation } = setup()
      fetchImplementation.mockResolvedValue(jsonResponse({ items: [{ id: 1 }], nextCursor: null }))
      await expect(api.listSquawks({ site: "x" })).rejects.toThrow()
   })
})
