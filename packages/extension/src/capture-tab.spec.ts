import { describe, expect, it, vi } from "vitest"
import { captureSenderTab } from "./capture-tab"

function senderFor(
   tab: Partial<chrome.tabs.Tab> | undefined,
   frameId = 0
): chrome.runtime.MessageSender {
   return { tab: tab as chrome.tabs.Tab | undefined, frameId }
}

describe("captureSenderTab", () => {
   it("captures the window of the active sender tab as PNG", async () => {
      const captureVisibleTab = vi.fn(async () => "data:image/png;base64,AA")

      const response = await captureSenderTab(
         senderFor({ id: 3, windowId: 9, active: true }),
         captureVisibleTab
      )

      expect(response).toEqual({ dataUrl: "data:image/png;base64,AA" })
      expect(captureVisibleTab).toHaveBeenCalledWith(9, { format: "png" })
   })

   it("refuses when the sender tab is not active", async () => {
      const captureVisibleTab = vi.fn(async () => "data:image/png;base64,AA")

      const response = await captureSenderTab(
         senderFor({ id: 3, windowId: 9, active: false }),
         captureVisibleTab
      )

      expect(response).toEqual({ error: expect.stringContaining("not the active tab") })
      expect(captureVisibleTab).not.toHaveBeenCalled()
   })

   it("refuses requests without a tab or from sub-frames", async () => {
      const captureVisibleTab = vi.fn(async () => "data:image/png;base64,AA")

      expect(await captureSenderTab(senderFor(undefined), captureVisibleTab)).toHaveProperty(
         "error"
      )
      expect(
         await captureSenderTab(
            senderFor({ id: 3, windowId: 9, active: true }, 4),
            captureVisibleTab
         )
      ).toHaveProperty("error")
      expect(captureVisibleTab).not.toHaveBeenCalled()
   })

   it("passes capture failures on as an error", async () => {
      const response = await captureSenderTab(senderFor({ id: 3, windowId: 9, active: true }), () =>
         Promise.reject(new Error('Cannot access contents of url "chrome://newtab/".'))
      )

      expect(response).toEqual({ error: 'Cannot access contents of url "chrome://newtab/".' })
   })
})
