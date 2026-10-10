import { captureSenderTab } from "./capture-tab"
import { isCaptureRequest } from "./runtime-messages"

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
   if (!isCaptureRequest(message)) return false
   void captureSenderTab(sender, (windowId, options) =>
      chrome.tabs.captureVisibleTab(windowId, options)
   ).then(sendResponse)
   return true
})
