import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DevicePollResponse } from "@squawk/shared"
import { ApiError } from "./api"
import { readToken, runDeviceLogin, runPopupLogin, writeToken } from "./auth"
import type { DeviceLoginState, LoginState } from "./auth"
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

const SERVER = "https://squawk.test"
const PAGE = "https://preview.test"

function setupPopup() {
   const popup = { closed: false, close: vi.fn() }
   const openWindow = vi.fn((_url: string, _features: string) => popup as unknown as Window)
   const states: LoginState["status"][] = []
   const onToken = vi.fn()
   const cancel = runPopupLogin({
      serverOrigin: SERVER,
      pageOrigin: PAGE,
      onState: state => states.push(state.status),
      onToken,
      openWindow
   })
   return { popup, openWindow, states, onToken, cancel }
}

function post(data: unknown, origin: string, source: unknown): void {
   const event = new MessageEvent("message", { data, origin })
   Object.defineProperty(event, "source", { value: source })
   window.dispatchEvent(event)
}

describe("runPopupLogin", () => {
   it("opens the connect page for the page origin and hands over the token", () => {
      const { popup, openWindow, states, onToken, cancel } = setupPopup()
      expect(cancel).toBeTypeOf("function")
      expect(openWindow.mock.calls[0]?.[0]).toBe(
         "https://squawk.test/connect?origin=https%3A%2F%2Fpreview.test"
      )
      expect(openWindow.mock.calls[0]?.[1]).toMatch(/width=480,height=640/)
      expect(states).toEqual(["popup"])

      post({ type: "squawk:connect", status: "ok", token: "sqk_popup" }, SERVER, popup)
      expect(onToken).toHaveBeenCalledWith("sqk_popup")
      expect(states).toEqual(["popup", "approved"])

      post({ type: "squawk:connect", status: "ok", token: "sqk_again" }, SERVER, popup)
      expect(onToken).toHaveBeenCalledTimes(1)
   })

   it("ignores messages from other origins, other windows or of other types", async () => {
      const { popup, states, onToken } = setupPopup()
      const message = { type: "squawk:connect", status: "ok", token: "sqk_forged" }
      post(message, "https://evil.test", popup)
      post(message, SERVER, window)
      post(message, SERVER, null)
      post({ ...message, type: "other" }, SERVER, popup)
      post({ type: "squawk:connect", status: "ok" }, SERVER, popup)
      post("squawk:connect", SERVER, popup)
      await vi.advanceTimersByTimeAsync(5000)
      expect(onToken).not.toHaveBeenCalled()
      expect(states).toEqual(["popup"])
   })

   it("reports a cancellation from the popup", () => {
      const { popup, states, onToken } = setupPopup()
      post({ type: "squawk:connect", status: "cancelled" }, SERVER, popup)
      expect(states).toEqual(["popup", "cancelled"])
      expect(onToken).not.toHaveBeenCalled()
   })

   it("reports a closed window once the message had a chance to arrive", async () => {
      const { popup, states } = setupPopup()
      await vi.advanceTimersByTimeAsync(1000)
      expect(states).toEqual(["popup"])
      popup.closed = true
      await vi.advanceTimersByTimeAsync(500)
      expect(states).toEqual(["popup"])
      await vi.advanceTimersByTimeAsync(500)
      expect(states).toEqual(["popup", "closed"])
      await vi.advanceTimersByTimeAsync(5000)
      expect(states).toEqual(["popup", "closed"])
      expect(vi.getTimerCount()).toBe(0)
   })

   it("cleans up and closes the popup when cancelled", async () => {
      const { popup, states, onToken, cancel } = setupPopup()
      cancel?.()
      expect(popup.close).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
      post({ type: "squawk:connect", status: "ok", token: "sqk_late" }, SERVER, popup)
      popup.closed = true
      await vi.advanceTimersByTimeAsync(5000)
      expect(onToken).not.toHaveBeenCalled()
      expect(states).toEqual(["popup"])
   })

   it("returns null without side effects when the popup is blocked", () => {
      const onState = vi.fn()
      const cancel = runPopupLogin({
         serverOrigin: SERVER,
         pageOrigin: PAGE,
         onState,
         onToken: vi.fn(),
         openWindow: () => null
      })
      expect(cancel).toBeNull()
      expect(onState).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
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
