import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
   createHarness,
   errorResponse,
   type Harness,
   jan,
   jsonResponse,
   recordedRequest
} from "../test-harness"

const SERVER = "https://login.test"

const deviceStart = {
   deviceCode: "device-secret",
   userCode: "WXYZ-1234",
   verificationUrl: `${SERVER}/device?code=WXYZ-1234`,
   expiresIn: 9,
   interval: 3
}

/**
 * Advances fake time until the command finishes. Real file I/O happens in between, so each step
 * also yields to the event loop.
 */
async function finish(promise: Promise<number>): Promise<number> {
   let settled = false
   void promise.finally(() => {
      settled = true
   })
   for (let step = 0; step < 200 && !settled; step++) {
      await vi.advanceTimersByTimeAsync(1000)
      await new Promise(resolve => setImmediate(resolve))
   }
   return promise
}

describe("squawk login", () => {
   let harness: Harness

   beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      harness = await createHarness({
         environment: { SQUAWK_SERVER: undefined, SQUAWK_TOKEN: undefined }
      })
   })

   afterEach(async () => {
      vi.useRealTimers()
      await harness.cleanup()
   })

   it("polls until approved and stores server and token", async () => {
      harness.fetchMock
         .mockResolvedValueOnce(jsonResponse(deviceStart))
         .mockResolvedValueOnce(jsonResponse({ status: "pending" }))
         .mockResolvedValueOnce(
            jsonResponse({
               status: "approved",
               token: "sqk_fresh",
               expiresAt: "2026-11-09T12:00:00.000Z",
               principal: jan
            })
         )

      const exitCode = await finish(harness.run("login", "--server", `${SERVER}/`))

      expect(exitCode).toBe(0)
      expect(recordedRequest(harness.fetchMock, 0)).toEqual({
         url: `${SERVER}/api/auth/device`,
         method: "POST",
         headers: { accept: "application/json", "content-type": "application/json" },
         body: { kind: "cli", label: "test-host" }
      })
      for (const index of [1, 2]) {
         const poll = recordedRequest(harness.fetchMock, index)
         expect([poll.method, poll.url, poll.body]).toEqual([
            "POST",
            `${SERVER}/api/auth/device/token`,
            { deviceCode: "device-secret" }
         ])
         expect(poll.headers.authorization).toBeUndefined()
      }
      expect(harness.openUrl).toHaveBeenCalledWith(deviceStart.verificationUrl)
      expect(harness.stderr()).toContain("WXYZ-1234")
      expect(harness.stdout()).toBe(`Logged in to ${SERVER} as Jan <jan@studypilot.app>.\n`)

      const path = join(harness.directory, "squawk", "config.json")
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
         server: SERVER,
         token: "sqk_fresh"
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
   })

   it("waits one interval between polls", async () => {
      harness.fetchMock
         .mockResolvedValueOnce(jsonResponse(deviceStart))
         .mockImplementation(async () => jsonResponse({ status: "pending" }))
      const run = harness.run("login", "--server", SERVER)
      while (harness.fetchMock.mock.calls.length === 0) {
         await new Promise(resolve => setImmediate(resolve))
      }
      await vi.advanceTimersByTimeAsync(2999)
      expect(harness.fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(harness.fetchMock).toHaveBeenCalledTimes(2)
      expect(await finish(run)).toBe(1)
   })

   it("treats rate limiting as pending", async () => {
      harness.fetchMock
         .mockResolvedValueOnce(jsonResponse(deviceStart))
         .mockResolvedValueOnce(errorResponse(429, "rate_limited", "Slow down"))
         .mockResolvedValueOnce(
            jsonResponse({
               status: "approved",
               token: "sqk_fresh",
               expiresAt: "2026-11-09T12:00:00.000Z",
               principal: jan
            })
         )
      expect(await finish(harness.run("login", "--server", SERVER))).toBe(0)
   })

   it("fails when the login is denied", async () => {
      harness.fetchMock
         .mockResolvedValueOnce(jsonResponse(deviceStart))
         .mockResolvedValueOnce(jsonResponse({ status: "denied" }))
      expect(await finish(harness.run("login", "--server", SERVER))).toBe(1)
      expect(harness.stderr()).toContain("denied")
   })

   it("gives up when the code expires", async () => {
      harness.fetchMock
         .mockResolvedValueOnce(jsonResponse(deviceStart))
         .mockImplementation(async () => jsonResponse({ status: "pending" }))
      expect(await finish(harness.run("login", "--server", SERVER))).toBe(1)
      // expiresIn 9 s at a 3 s interval: three polls, then stop.
      expect(harness.fetchMock).toHaveBeenCalledTimes(4)
      expect(harness.stderr()).toContain("expired")
   })

   it("asks for a server when none is known", async () => {
      expect(await harness.run("login")).toBe(1)
      expect(harness.stderr()).toContain("--server")
      expect(harness.fetchMock).not.toHaveBeenCalled()
   })
})
