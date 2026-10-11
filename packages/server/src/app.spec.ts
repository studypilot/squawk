import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestContext, type TestContext } from "./testing/test-context"

let context: TestContext

beforeAll(async () => {
   context = await createTestContext()
})

afterAll(() => context.close())

describe("static files and health", () => {
   it("answers 503 for inbox routes while the inbox is not built", async () => {
      const response = await context.request("GET", "/sites/main")
      expect(response.status).toBe(503)
      expect(await response.text()).toBe("inbox not built")
   })

   it("serves squawk.js with a short cache and an ETag", async () => {
      await writeFile(path.join(context.publicDir, "squawk.js"), "console.log('squawk')")
      const response = await context.request("GET", "/squawk.js")
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("public, max-age=300")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      const etag = response.headers.get("etag")
      expect(etag).toBeTruthy()

      const revalidated = await context.request("GET", "/squawk.js", {
         headers: { "If-None-Match": etag! }
      })
      expect(revalidated.status).toBe(304)
   })

   it("serves hashed assets as immutable and falls back to index.html", async () => {
      await mkdir(path.join(context.publicDir, "assets"), { recursive: true })
      await writeFile(path.join(context.publicDir, "assets", "index-abc123.js"), "export {}")
      await writeFile(
         path.join(context.publicDir, "index.html"),
         "<!doctype html><title>Inbox</title>"
      )

      const asset = await context.request("GET", "/assets/index-abc123.js")
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")

      const missingAsset = await context.request("GET", "/assets/missing.js")
      expect(missingAsset.status).toBe(404)

      const spaRoute = await context.request("GET", "/squawks/some-id")
      expect(spaRoute.status).toBe(200)
      expect(spaRoute.headers.get("cache-control")).toBe("no-cache")
      expect(await spaRoute.text()).toContain("<title>Inbox</title>")
   })

   it("lets any origin load the fonts, nothing else", async () => {
      await mkdir(path.join(context.publicDir, "fonts"), { recursive: true })
      await writeFile(path.join(context.publicDir, "fonts", "inter.css"), "@font-face {}")

      const font = await context.request("GET", "/fonts/inter.css")
      expect(font.status).toBe(200)
      expect(font.headers.get("access-control-allow-origin")).toBe("*")

      const script = await context.request("GET", "/squawk.js")
      expect(script.headers.get("access-control-allow-origin")).toBeNull()
   })

   it("never serves files outside the public directory", async () => {
      const response = await context.request("GET", "/..%2f..%2fetc%2fpasswd")
      expect(await response.text()).not.toContain("root:")
   })

   it("returns JSON 404s for unknown API routes", async () => {
      const response = await context.request("GET", "/api/nope")
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
         error: { code: "not_found", message: "No such API route" }
      })
   })

   it("reports health", async () => {
      const response = await context.request("GET", "/healthz")
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
   })

   it("answers 503 on /auth/login without OIDC configuration", async () => {
      const response = await context.request("GET", "/auth/login")
      expect(response.status).toBe(503)
   })

   it("clears the session cookie on logout", async () => {
      const response = await context.request("POST", "/auth/logout")
      expect(response.status).toBe(204)
      expect(response.headers.get("set-cookie")).toContain("squawk_session=;")
   })
})
