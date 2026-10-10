import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionMessage } from "@squawk/shared"
import { createExtensionBridge } from "./extension"

function reply(data: unknown, source: Window | null = window): void {
   window.dispatchEvent(new MessageEvent("message", { data, source }))
}

function postedMessages(): ExtensionMessage[] {
   return vi.mocked(window.postMessage).mock.calls.map(([message]) => message as ExtensionMessage)
}

beforeEach(() => {
   vi.useFakeTimers()
   vi.spyOn(window, "postMessage").mockImplementation(() => undefined)
})

afterEach(() => {
   vi.restoreAllMocks()
   vi.useRealTimers()
})

describe("extension bridge", () => {
   it("reports no extension when no pong arrives within 300 ms", async () => {
      const bridge = createExtensionBridge()
      const detected = bridge.detect()
      expect(postedMessages()).toEqual([{ source: "squawk", type: "ext:ping" }])

      await vi.advanceTimersByTimeAsync(300)

      await expect(detected).resolves.toBe(false)
      expect(bridge.available).toBe(false)
   })

   it("detects the extension from a pong", async () => {
      const bridge = createExtensionBridge()
      const detected = bridge.detect()
      reply({ source: "squawk", type: "ext:pong", version: "0.1.0" })
      await expect(detected).resolves.toBe(true)
      expect(bridge.available).toBe(true)
   })

   it("ignores pongs from other windows and foreign messages", async () => {
      const bridge = createExtensionBridge()
      const detected = bridge.detect()
      reply({ source: "squawk", type: "ext:pong", version: "0.1.0" }, null)
      reply({ source: "someone-else", type: "ext:pong" })
      await vi.advanceTimersByTimeAsync(300)
      await expect(detected).resolves.toBe(false)
   })

   it("returns the capture for its own request id", async () => {
      const bridge = createExtensionBridge()
      const captured = bridge.capture()
      const request = postedMessages()[0]
      if (request?.type !== "ext:capture") throw new Error("no capture request posted")

      reply({
         source: "squawk",
         type: "ext:captured",
         requestId: "other",
         dataUrl: "data:x",
         devicePixelRatio: 1
      })
      reply({
         source: "squawk",
         type: "ext:captured",
         requestId: request.requestId,
         dataUrl: "data:image/png;base64,AAAA",
         devicePixelRatio: 2
      })

      await expect(captured).resolves.toEqual({
         dataUrl: "data:image/png;base64,AAAA",
         devicePixelRatio: 2
      })
   })

   it("gives up after 5 s or on an error reply", async () => {
      const bridge = createExtensionBridge()
      const timedOut = bridge.capture()
      await vi.advanceTimersByTimeAsync(5000)
      await expect(timedOut).resolves.toBeNull()

      const failed = bridge.capture()
      const request = postedMessages().at(-1)
      if (request?.type !== "ext:capture") throw new Error("no capture request posted")
      reply({
         source: "squawk",
         type: "ext:captured",
         requestId: request.requestId,
         dataUrl: null,
         devicePixelRatio: 1,
         error: "No user activation"
      })
      await expect(failed).resolves.toBeNull()
   })
})
