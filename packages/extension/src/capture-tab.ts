import { describeError, type CaptureResponse } from "./runtime-messages"

type CaptureVisibleTab = (windowId: number, options: { format: "png" }) => Promise<string>

/**
 * Captures the visible area of the tab that sent the request. Refuses when the sender is not the
 * top frame of the active tab in its window, because `captureVisibleTab` would otherwise return
 * a different tab's pixels.
 */
export async function captureSenderTab(
   sender: chrome.runtime.MessageSender,
   captureVisibleTab: CaptureVisibleTab
): Promise<CaptureResponse> {
   const tab = sender.tab
   if (!tab) return { error: "Capture refused: the request did not come from a tab." }
   if (sender.frameId !== 0) return { error: "Capture refused: the request came from a sub-frame." }
   if (!tab.active)
      return { error: "Capture refused: the tab is not the active tab of its window." }
   try {
      return { dataUrl: await captureVisibleTab(tab.windowId, { format: "png" }) }
   } catch (error) {
      return { error: describeError(error) }
   }
}
