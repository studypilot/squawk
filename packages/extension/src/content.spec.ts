import { afterEach, describe, expect, it, vi } from "vitest"

describe("content script entry", () => {
   afterEach(() => {
      Reflect.deleteProperty(window.navigator, "userActivation")
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
   })

   it("routes a capture through chrome.runtime and posts ext:captured with the request id", async () => {
      const sendMessage = vi.fn(async () => ({ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }))
      vi.stubGlobal("chrome", {
         runtime: { sendMessage, getManifest: () => ({ version: "0.1.0" }) }
      })
      Object.defineProperty(window.navigator, "userActivation", {
         value: { isActive: true, hasBeenActive: true },
         configurable: true
      })
      const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined)
      await import("./content")

      window.dispatchEvent(
         new MessageEvent("message", {
            data: { source: "squawk", type: "ext:ping" },
            source: window
         })
      )
      window.dispatchEvent(
         new MessageEvent("message", {
            data: { source: "squawk", type: "ext:capture", requestId: "pin-42" },
            source: window
         })
      )
      await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalledTimes(2))

      expect(sendMessage).toHaveBeenCalledWith({ type: "capture" })
      expect(postMessageSpy.mock.calls[0]?.[0]).toEqual({
         source: "squawk",
         type: "ext:pong",
         version: "0.1.0"
      })
      expect(postMessageSpy.mock.calls[1]).toEqual([
         {
            source: "squawk",
            type: "ext:captured",
            requestId: "pin-42",
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            devicePixelRatio: window.devicePixelRatio
         },
         window.location.origin
      ])
   })
})
