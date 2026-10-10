import type { Anchor, Screenshot } from "@squawk/shared"
import { screenshotPath } from "../api/client"

export interface PinPosition {
   leftPercent: number
   topPercent: number
}

/**
 * Where the pin sits on the screenshot, in percent of its width and height. The click point is
 * `elementBox` plus `rect` in viewport pixels. Captures scale the viewport uniformly (device
 * pixel ratio, downscaling), so the width ratio maps viewport pixels to screenshot pixels even
 * when the screenshot is cropped vertically. Points outside the screenshot yield `null`.
 */
export function computePinPosition(
   anchor: Anchor,
   screenshot: Pick<Screenshot, "width" | "height">
): PinPosition | null {
   const pointX = anchor.elementBox.x + anchor.rect.x * anchor.elementBox.width
   const pointY = anchor.elementBox.y + anchor.rect.y * anchor.elementBox.height
   const scale = screenshot.width / anchor.viewport.width
   const left = (pointX * scale) / screenshot.width
   const top = (pointY * scale) / screenshot.height
   if (left < 0 || left > 1 || top < 0 || top > 1) {
      return null
   }
   return { leftPercent: left * 100, topPercent: top * 100 }
}

export function ScreenshotWithPin({
   screenshot,
   anchor,
   label
}: {
   screenshot: Screenshot
   anchor: Anchor | null
   label: string
}) {
   const position = anchor === null ? null : computePinPosition(anchor, screenshot)
   return (
      <figure className="screenshot">
         <div className="screenshot-frame">
            <img
               src={screenshotPath(screenshot.id)}
               width={screenshot.width}
               height={screenshot.height}
               alt={`Screenshot of ${label}`}
            />
            {position !== null && (
               <span
                  className="pin"
                  data-testid="pin"
                  title="Pinned spot"
                  style={{ left: `${position.leftPercent}%`, top: `${position.topPercent}%` }}
               />
            )}
         </div>
         {screenshot.source === "dom" && (
            <figcaption className="muted">
               Approximate screenshot, rendered from the page DOM. Install the Squawk extension for
               exact captures.
            </figcaption>
         )}
      </figure>
   )
}
