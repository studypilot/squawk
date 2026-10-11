import type { Anchor, Screenshot } from "@squawk/shared"
import { useState } from "react"
import { screenshotPath } from "../api/client"
import { ImageIcon } from "./icons"
import { Lightbox } from "./lightbox"

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

function PinnedImage({
   screenshot,
   position,
   label,
   lazy = false
}: {
   screenshot: Screenshot
   position: PinPosition | null
   label: string
   lazy?: boolean
}) {
   return (
      <>
         <img
            src={screenshotPath(screenshot.id)}
            width={screenshot.width}
            height={screenshot.height}
            alt={`Screenshot of ${label}`}
            loading={lazy ? "lazy" : undefined}
         />
         {position !== null && (
            <span
               className="pin"
               data-testid="pin"
               title="Pinned spot"
               style={{ left: `${position.leftPercent}%`, top: `${position.topPercent}%` }}
            />
         )}
      </>
   )
}

/** The screenshot in a card with the pin marker. Clicking opens it full size. */
export function ScreenshotWithPin({
   screenshot,
   anchor,
   label
}: {
   screenshot: Screenshot
   anchor: Anchor | null
   label: string
}) {
   const [expanded, setExpanded] = useState(false)
   const position = anchor === null ? null : computePinPosition(anchor, screenshot)
   const portrait = screenshot.height > screenshot.width

   return (
      <figure className="screenshot">
         <button
            type="button"
            className={portrait ? "screenshot-frame screenshot-frame-portrait" : "screenshot-frame"}
            aria-label="Open screenshot full size"
            onClick={() => setExpanded(true)}
         >
            <PinnedImage screenshot={screenshot} position={position} label={label} />
         </button>
         {screenshot.source === "dom" && (
            <figcaption>
               Approximate screenshot, rendered from the page DOM. Install the Squawk extension for
               exact captures.
            </figcaption>
         )}
         {expanded && (
            <Lightbox onClose={() => setExpanded(false)}>
               <div className="screenshot-frame screenshot-frame-full">
                  <PinnedImage screenshot={screenshot} position={position} label={label} />
               </div>
            </Lightbox>
         )}
      </figure>
   )
}

/** The tile shows roughly this many CSS pixels of the captured page, whatever the viewport was. */
const THUMBNAIL_WINDOW_PX = 320

/**
 * A square tile cropped around the pin. The image is drawn wide enough that the tile covers about
 * `THUMBNAIL_WINDOW_PX` of the page and shifted so the pin sits in the centre, clamped so the tile
 * never shows blank space.
 */
export function ScreenshotThumbnail({
   screenshot,
   anchor
}: {
   screenshot: Screenshot | null
   anchor: Anchor | null
}) {
   if (screenshot === null) {
      return (
         <span className="thumbnail thumbnail-empty" aria-hidden="true">
            <ImageIcon size={18} />
         </span>
      )
   }
   const position = anchor === null ? null : computePinPosition(anchor, screenshot)
   const viewportWidth = anchor?.viewport.width ?? screenshot.width / screenshot.devicePixelRatio
   const zoom = Math.max(1.5, viewportWidth / THUMBNAIL_WINDOW_PX)
   const imageWidth = zoom * 100
   const imageHeight = (imageWidth * screenshot.height) / screenshot.width
   const focus = position ?? { leftPercent: 25, topPercent: 15 }
   const left = clamp(50 - (focus.leftPercent / 100) * imageWidth, 100 - imageWidth, 0)
   const top = clamp(50 - (focus.topPercent / 100) * imageHeight, Math.min(0, 100 - imageHeight), 0)
   const pinLeft = left + (focus.leftPercent / 100) * imageWidth
   const pinTop = top + (focus.topPercent / 100) * imageHeight

   return (
      <span className="thumbnail" aria-hidden="true">
         <img
            src={screenshotPath(screenshot.id)}
            alt=""
            loading="lazy"
            style={{ width: `${imageWidth}%`, left: `${left}%`, top: `${top}%` }}
         />
         {position !== null && (
            <span className="pin pin-small" style={{ left: `${pinLeft}%`, top: `${pinTop}%` }} />
         )}
      </span>
   )
}

function clamp(value: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, value))
}
