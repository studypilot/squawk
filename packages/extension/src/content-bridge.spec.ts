import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ExtensionCaptureResultMessage } from "@squawk/shared"
import { INTERACTION_WINDOW_MS, installContentBridge } from "./content-bridge"
import type { CaptureResponse } from "./runtime-messages"

const ping = { source: "squawk", type: "ext:ping" }
const captureRequest = { source: "squawk", type: "ext:capture", requestId: "request-1" }

let postMessageSpy: MockInstance<Window["postMessage"]>
let uninstall: (() => void) | undefined

function sendFromPage(data: unknown, source: Window | null = window): void {
   window.dispatchEvent(new MessageEvent("message", { data, source }))
}

async function flushPromises(): Promise<void> {
   for (let tick = 0; tick < 10; tick++) await Promise.resolve()
}

function postedMessages(): unknown[] {
   return postMessageSpy.mock.calls.map(call => call[0])
}

function capturedResult(): ExtensionCaptureResultMessage | undefined {
   return postedMessages().find(
      (message): message is ExtensionCaptureResultMessage =>
         (message as { type?: unknown }).type === "ext:captured"
   )
}

function setUserActivation(isActive: boolean | undefined): void {
   if (isActive === undefined) {
      Reflect.deleteProperty(window.navigator, "userActivation")
      return
   }
   Object.defineProperty(window.navigator, "userActivation", {
      value: { isActive, hasBeenActive: isActive },
      configurable: true
   })
}

function install(
   requestCapture: () => Promise<CaptureResponse>,
   isTrustedEvent?: (event: Event) => boolean
): void {
   uninstall = installContentBridge({ window, version: "1.2.3", requestCapture, isTrustedEvent })
}

beforeEach(() => {
   postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined)
})

afterEach(() => {
   uninstall?.()
   uninstall = undefined
   setUserActivation(undefined)
   vi.restoreAllMocks()
   vi.useRealTimers()
})

describe("message guard", () => {
   it("ignores messages that do not come from the page's own window", () => {
      install(vi.fn())
      const frame = document.createElement("iframe")
      document.body.append(frame)

      sendFromPage(ping, frame.contentWindow)
      sendFromPage(ping, null)

      expect(postMessageSpy).not.toHaveBeenCalled()
      frame.remove()
   })

   it("ignores messages with the wrong shape", async () => {
      setUserActivation(true)
      const requestCapture = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA" }))
      install(requestCapture)

      sendFromPage("ext:ping")
      sendFromPage({ type: "ext:ping" })
      sendFromPage({ source: "other", type: "ext:ping" })
      sendFromPage({ source: "squawk", type: 42 })
      expect(postMessageSpy).not.toHaveBeenCalled()

      sendFromPage(ping)
      postMessageSpy.mockClear()
      sendFromPage({ source: "squawk", type: "ext:capture" })
      sendFromPage({ source: "squawk", type: "ext:capture", requestId: "" })
      sendFromPage({ source: "squawk", type: "ext:capture", requestId: 7 })
      sendFromPage({ source: "squawk", type: "ext:captured", requestId: "x", dataUrl: null })
      await flushPromises()

      expect(postMessageSpy).not.toHaveBeenCalled()
      expect(requestCapture).not.toHaveBeenCalled()
   })

   it("answers a ping with a pong to the page's own origin", () => {
      install(vi.fn())

      sendFromPage(ping)

      expect(postMessageSpy).toHaveBeenCalledWith(
         { source: "squawk", type: "ext:pong", version: "1.2.3" },
         window.location.origin
      )
   })
})

describe("handshake", () => {
   it("refuses a capture when the document has not pinged", async () => {
      setUserActivation(true)
      const requestCapture = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA" }))
      install(requestCapture)

      sendFromPage(captureRequest)
      await flushPromises()

      expect(requestCapture).not.toHaveBeenCalled()
      expect(capturedResult()).toMatchObject({
         requestId: "request-1",
         dataUrl: null,
         error: expect.stringContaining("did not ping")
      })
   })
})

describe("user activation gate", () => {
   it("follows navigator.userActivation.isActive when available", async () => {
      const requestCapture = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA" }))
      install(requestCapture, () => true)
      sendFromPage(ping)

      setUserActivation(false)
      window.dispatchEvent(new Event("pointerdown"))
      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).not.toHaveBeenCalled()
      expect(capturedResult()?.error).toContain("no recent click")

      setUserActivation(true)
      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).toHaveBeenCalledTimes(1)
   })

   it("falls back to a five second window after a trusted pointer or key event", async () => {
      vi.useFakeTimers()
      const requestCapture = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA" }))
      install(requestCapture, () => true)
      sendFromPage(ping)

      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).not.toHaveBeenCalled()

      window.dispatchEvent(new Event("pointerdown"))
      vi.advanceTimersByTime(INTERACTION_WINDOW_MS)
      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1)
      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }))
      sendFromPage(captureRequest)
      await flushPromises()
      expect(requestCapture).toHaveBeenCalledTimes(2)
   })

   it("does not count synthetic events dispatched by the page", async () => {
      const requestCapture = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA" }))
      install(requestCapture)
      sendFromPage(ping)

      window.dispatchEvent(new Event("pointerdown"))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }))
      sendFromPage(captureRequest)
      await flushPromises()

      expect(requestCapture).not.toHaveBeenCalled()
   })
})

describe("capture round trip", () => {
   it("reports a failing background request as an error result", async () => {
      setUserActivation(true)
      install(async () => {
         throw new Error("Extension context invalidated.")
      })
      sendFromPage(ping)

      sendFromPage(captureRequest)
      await flushPromises()

      expect(capturedResult()).toEqual({
         source: "squawk",
         type: "ext:captured",
         requestId: "request-1",
         dataUrl: null,
         devicePixelRatio: window.devicePixelRatio,
         error: "Extension context invalidated."
      })
   })
})
