import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DevicePollResponse } from "@squawk/shared"
import { ApiError } from "./api"
import { readToken, runDeviceLogin, writeToken } from "./auth"
import type { DeviceLoginState } from "./auth"
import { USER_ID } from "./test-fixtures"

const APPROVED: DevicePollResponse = {
   status: "approved",
   token: "sqk_new",
   expiresAt: "2026-11-10T12:00:00.000Z",
   principal: { kind: "user", id: USER_ID, email: "a@example.com", name: null, avatarUrl: null }
}

function setup(polls: (DevicePollResponse | Error)[]) {
   const states: DeviceLoginState["status"][] = []
   const onToken = vi.fn()
   const pollDeviceLogin = vi.fn(async () => {
      const next = polls.shift() ?? { status: "pending" as const }
      if (next instanceof Error) throw next
      return next
   })
   const api = {
      startDeviceLogin: vi.fn(async () => ({
         deviceCode: "device",
         userCode: "WXYZ-1234",
         verificationUrl: "https://squawk.test/device?code=WXYZ-1234",
         expiresIn: 600,
         interval: 3
      })),
      pollDeviceLogin
   }
   const cancel = runDeviceLogin({
      api,
      label: "https://preview.test",
      onState: state => states.push(state.status),
      onToken
   })
   return { states, onToken, pollDeviceLogin, cancel }
}

beforeEach(() => {
   vi.useFakeTimers()
})

afterEach(() => {
   vi.useRealTimers()
})

describe("runDeviceLogin", () => {
   it("polls every interval until approved and hands over the token", async () => {
      const { states, onToken, pollDeviceLogin } = setup([{ status: "pending" }, APPROVED])

      await vi.advanceTimersByTimeAsync(0)
      expect(states).toEqual(["starting", "waiting"])
      expect(pollDeviceLogin).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(2999)
      expect(pollDeviceLogin).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(3000)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(2)
      expect(onToken).toHaveBeenCalledWith("sqk_new")
      expect(states.at(-1)).toBe("approved")

      await vi.advanceTimersByTimeAsync(30_000)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(2)
   })

   it("stops on denial", async () => {
      const { states, onToken, pollDeviceLogin } = setup([{ status: "denied" }])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(states.at(-1)).toBe("denied")
      expect(pollDeviceLogin).toHaveBeenCalledTimes(1)
      expect(onToken).not.toHaveBeenCalled()
   })

   it("expires locally once the code lifetime is over", async () => {
      const { states, pollDeviceLogin } = setup([])
      await vi.advanceTimersByTimeAsync(601_000)
      expect(states.at(-1)).toBe("expired")
      const callsAtExpiry = pollDeviceLogin.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(callsAtExpiry)
   })

   it("slows down when rate limited and retries after network errors", async () => {
      const { pollDeviceLogin } = setup([
         new ApiError(429, "rate_limited", "Slow down"),
         new ApiError(0, "network", "offline"),
         APPROVED
      ])
      await vi.advanceTimersByTimeAsync(3000)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(7999)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(8000)
      expect(pollDeviceLogin).toHaveBeenCalledTimes(3)
   })

   it("reports other errors and stops", async () => {
      const { states } = setup([new ApiError(500, "internal", "Boom")])
      await vi.advanceTimersByTimeAsync(3000)
      expect(states.at(-1)).toBe("error")
   })

   it("stops polling when cancelled", async () => {
      const { states, pollDeviceLogin, cancel } = setup([])
      await vi.advanceTimersByTimeAsync(0)
      cancel()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(pollDeviceLogin).not.toHaveBeenCalled()
      expect(states).toEqual(["starting", "waiting"])
   })
})

describe("token storage", () => {
   it("stores the token per server origin", () => {
      writeToken("https://squawk.test", "sqk_a")
      expect(localStorage.getItem("squawk:https://squawk.test:token")).toBe("sqk_a")
      expect(readToken("https://squawk.test")).toBe("sqk_a")
      expect(readToken("https://other.test")).toBeNull()
      writeToken("https://squawk.test", null)
      expect(readToken("https://squawk.test")).toBeNull()
   })
})
