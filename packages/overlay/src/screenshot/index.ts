import { LIMITS } from "@squawk/shared"
import { captureDomScreenshot } from "./dom"
import type { ExtensionBridge } from "./extension"

export interface CapturedScreenshot {
   blob: Blob
   /** Object URL of `blob` for previews; the owner revokes it. */
   previewUrl: string
   width: number
   height: number
   /** Image pixels per CSS pixel of the captured viewport. */
   devicePixelRatio: number
   source: "extension" | "dom"
}

const DOM_CAPTURE_TIMEOUT_MS = 15_000
const MIN_SHRINK_WIDTH = 640

/**
 * Hides the overlay, waits two frames, captures the viewport through the extension or the DOM
 * fallback, shows the overlay again and returns a PNG no wider than the server accepts.
 * Resolves null when both ways fail.
 */
export async function takeScreenshot(
   bridge: ExtensionBridge,
   overlayHost: HTMLElement
): Promise<CapturedScreenshot | null> {
   const viewportWidth = window.innerWidth
   let dataUrl: string
   let source: CapturedScreenshot["source"]
   overlayHost.style.setProperty("visibility", "hidden", "important")
   try {
      await nextFrames(2)
      const fromExtension = bridge.available ? await bridge.capture() : null
      source = fromExtension ? "extension" : "dom"
      dataUrl =
         fromExtension?.dataUrl ??
         (await withTimeout(captureDomScreenshot(overlayHost), DOM_CAPTURE_TIMEOUT_MS))
   } catch {
      return null
   } finally {
      overlayHost.style.removeProperty("visibility")
   }
   try {
      const { blob, width, height } = await encodePng(dataUrl)
      return {
         blob,
         previewUrl: URL.createObjectURL(blob),
         width,
         height,
         devicePixelRatio: width / viewportWidth,
         source
      }
   } catch {
      return null
   }
}

function nextFrames(count: number): Promise<void> {
   return new Promise(resolve => {
      const step = (remaining: number): void => {
         if (remaining === 0) return resolve()
         requestAnimationFrame(() => step(remaining - 1))
      }
      step(count)
   })
}

function withTimeout<Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> {
   return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Screenshot timed out")), timeoutMs)
      promise.then(
         value => {
            clearTimeout(timer)
            resolve(value)
         },
         (error: unknown) => {
            clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
         }
      )
   })
}

/** Scales to at most `screenshotMaxWidth` and shrinks further while the PNG is too large. */
async function encodePng(dataUrl: string): Promise<{ blob: Blob; width: number; height: number }> {
   const image = new Image()
   image.src = dataUrl
   await image.decode()
   let scale = Math.min(1, LIMITS.screenshotMaxWidth / image.naturalWidth)
   for (;;) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas is not available")
      context.drawImage(image, 0, 0, width, height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"))
      if (!blob) throw new Error("PNG encoding failed")
      if (blob.size <= LIMITS.screenshotMaxBytes || width <= MIN_SHRINK_WIDTH) {
         return { blob, width, height }
      }
      scale *= 0.7
   }
}
