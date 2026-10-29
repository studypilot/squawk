import type { Anchor, Screenshot } from "@squawk/shared"
import { useState } from "react"
import { screenshotPath } from "../api/client"
import { ImageIcon } from "./icons"
import { Lightbox } from "./lightbox"

export interface PinPosition {
   leftPercent: number
   topPercent: number
}

export interface AreaBox extends PinPosition {
   widthPercent: number
   heightPercent: number
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

/**
 * The outlined area of an area squawk, in percent of the screenshot, or `null` for point squawks
 * and areas that lie entirely outside the screenshot.
 */
export function computeAreaBox(
   anchor: Anchor,
   screenshot: Pick<Screenshot, "width" | "height">
): AreaBox | null {
   const { area } = anchor
   if (area === undefined) {
      return null
   }
   const scale = screenshot.width / anchor.viewport.width
   const left = (area.x * scale) / screenshot.width
   const top = (area.y * scale) / screenshot.height
   const width = (area.width * scale) / screenshot.width
   const height = (area.height * scale) / screenshot.height
   if (left > 1 || top > 1 || left + width < 0 || top + height < 0) {
      return null
   }
   return {
      leftPercent: left * 100,
      topPercent: top * 100,
      widthPercent: width * 100,
      heightPercent: height * 100
   }
}

/** The pin dot for a point squawk, or the outlined rectangle for an area squawk. */
function Marker({ anchor, screenshot }: { anchor: Anchor; screenshot: Screenshot }) {
   const area = computeAreaBox(anchor, screenshot)
   if (area !== null) {
      return (
         <span
            className="pin-area"
            data-testid="pin-area"
            title="Marked area"
            style={{
               left: `${area.leftPercent}%`,
               top: `${area.topPercent}%`,
               width: `${area.widthPercent}%`,
               height: `${area.heightPercent}%`
            }}
         />
      )
   }
   if (anchor.area !== undefined) {
      return null
   }
   const position = computePinPosition(anchor, screenshot)
   if (position === null) {
      return null
   }
   return (
      <span
         className="pin"
         data-testid="pin"
         title="Pinned spot"
         style={{ left: `${position.leftPercent}%`, top: `${position.topPercent}%` }}
      />
   )
}

function PinnedImage({
   screenshot,
   anchor,
   label,
   lazy = false
}: {
   screenshot: Screenshot
   anchor: Anchor | null
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
         {anchor !== null && <Marker anchor={anchor} screenshot={screenshot} />}
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
   const portrait = screenshot.height > screenshot.width

   return (
      <figure className="screenshot">
         <button
            type="button"
            className={portrait ? "screenshot-frame screenshot-frame-portrait" : "screenshot-frame"}
            aria-label="Open screenshot full size"
            onClick={() => setExpanded(true)}
         >
            <PinnedImage screenshot={screenshot} anchor={anchor} label={label} />
         </button>
         {screenshot.source === "dom" && (
            <figcaption>
               Approximate screenshot, rendered from the page DOM. Install the Squawk extension for
               exact captures.
            </figcaption>
         )}
         {expanded && (
            <Lightbox onClose={() => setExpanded(false)}>
               <div
                  className="screenshot-frame screenshot-frame-full"
                  style={{
                     width: `min(calc(100vw - 64px), calc((100vh - 64px) * ${screenshot.width} / ${screenshot.height}))`
                  }}
               >
                  <PinnedImage screenshot={screenshot} anchor={anchor} label={label} />
               </div>
            </Lightbox>
         )}
      </figure>
   )
}

/** The tile shows roughly this many CSS pixels of the captured page, whatever the viewport was. */
const THUMBNAIL_WINDOW_PX = 320

/** An area is shown with this much room around it in the thumbnail. */
const THUMBNAIL_AREA_MARGIN = 1.3

/**
 * A square tile cropped around the pin. The image is drawn wide enough that the tile covers about
 * `THUMBNAIL_WINDOW_PX` of the page (or the whole area with some margin) and shifted so the pin
 * or the area's centre sits in the middle, clamped so the tile never shows blank space.
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
   const area = anchor === null ? null : computeAreaBox(anchor, screenshot)
   const position =
      anchor === null || anchor.area !== undefined ? null : computePinPosition(anchor, screenshot)
   const viewportWidth = anchor?.viewport.width ?? screenshot.width / screenshot.devicePixelRatio
   const areaExtent = anchor?.area
      ? Math.max(anchor.area.width, anchor.area.height) * THUMBNAIL_AREA_MARGIN
      : 0
   // Pins get a close-up; an area is zoomed out as far as needed to show all of it.
   const zoom = Math.max(
      area === null ? 1.5 : 1,
      viewportWidth / Math.max(THUMBNAIL_WINDOW_PX, areaExtent)
   )
   const imageWidth = zoom * 100
   const imageHeight = (imageWidth * screenshot.height) / screenshot.width
   const focus =
      position ??
      (area === null
         ? { leftPercent: 25, topPercent: 15 }
         : {
              leftPercent: area.leftPercent + area.widthPercent / 2,
              topPercent: area.topPercent + area.heightPercent / 2
           })
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
         {area !== null && (
            <span
               className="pin-area pin-area-small"
               style={{
                  left: `${left + (area.leftPercent / 100) * imageWidth}%`,
                  top: `${top + (area.topPercent / 100) * imageHeight}%`,
                  width: `${(area.widthPercent / 100) * imageWidth}%`,
                  height: `${(area.heightPercent / 100) * imageHeight}%`
               }}
            />
         )}
      </span>
   )
}

function clamp(value: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, value))
}
