import { installContentBridge } from "./content-bridge"
import { isCaptureResponse, type CaptureRequest, type CaptureResponse } from "./runtime-messages"

async function requestCapture(): Promise<CaptureResponse> {
   const request: CaptureRequest = { type: "capture" }
   const response: unknown = await chrome.runtime.sendMessage(request)
   if (isCaptureResponse(response)) return response
   return { error: "The extension answered without a screenshot." }
}

installContentBridge({
   window,
   version: chrome.runtime.getManifest().version,
   requestCapture
})
