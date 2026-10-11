import { LIMITS } from "@squawk/shared"
import type { Anchor, Author } from "@squawk/shared"
import type { CapturedScreenshot } from "../screenshot"
import { autoGrow, avatar, h, icon, spinner } from "./dom"
import { authorName } from "./format"

export interface ComposerOptions {
   anchor: Anchor
   screenshot: CapturedScreenshot | null
   /** The signed-in user, shown in the footer; null while unknown. */
   user: Author | null
   submit(body: string): Promise<void>
   close(): void
}

const CARD_WIDTH = 360
const CARD_GAP = 12
const VIEWPORT_MARGIN = 16
const ARROW_INSET = 22
const ARROW_HALF = 6
/** Used until the card is in the DOM and can report its real height. */
const CARD_HEIGHT_ESTIMATE = 400
/** The bottom sheet takes over below this width; the card is not positioned there. */
const SHEET_MAX_WIDTH = 639
/** The pin is kept inside the middle third of the thumbnail crop. */
const CROP_BIAS_MIN = 1 / 3
const CROP_BIAS_MAX = 2 / 3

/**
 * Card with screenshot preview, comment field and Cancel / Send, placed next to the pin with an
 * arrow pointing at it. Returns a wrapper that also carries the draft pin on the page.
 */
export function createComposer(options: ComposerOptions): HTMLElement {
   const { anchor, screenshot, user } = options
   const textarea = h("textarea", {
      placeholder: "What should change here?",
      "aria-label": "Comment",
      maxlength: LIMITS.bodyMaxLength
   })
   autoGrow(textarea, 2, 6)
   const error = h("div", { class: "error", hidden: true })
   const sendButton = h("button", { class: "button primary", type: "button" }, [
      "Send",
      h("kbd", {}, ["⌘↵"]),
      spinner()
   ])
   const cancelButton = h(
      "button",
      { class: "button ghost", type: "button", onclick: () => options.close() },
      ["Cancel"]
   )

   async function send(): Promise<void> {
      const body = textarea.value.trim()
      if (!body || sendButton.classList.contains("is-busy")) return
      sendButton.classList.add("is-busy")
      sendButton.setAttribute("aria-busy", "true")
      error.hidden = true
      try {
         await options.submit(body)
         options.close()
      } catch (failure) {
         error.textContent = failure instanceof Error ? failure.message : "Sending failed"
         error.hidden = false
         sendButton.classList.remove("is-busy")
         sendButton.removeAttribute("aria-busy")
      }
   }

   sendButton.addEventListener("click", () => void send())
   textarea.addEventListener("keydown", event => {
      if (event.key === "Escape") options.close()
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send()
   })

   const arrow = h("span", { class: "composer-arrow" })
   const card = h("div", { class: "composer", role: "dialog", "aria-label": "New squawk" }, [
      arrow,
      ...preview(anchor, screenshot),
      textarea,
      error,
      h("div", { class: "composer-footer" }, [
         h(
            "div",
            { class: "composer-user" },
            user ? [avatar(user, 20), h("span", { class: "name" }, [authorName(user)])] : []
         ),
         h("div", { class: "actions" }, [cancelButton, sendButton])
      ])
   ])
   const draftPin = h("span", { class: "draft-pin", "aria-hidden": "true" })
   draftPin.style.left = `${anchor.page.x - window.scrollX}px`
   draftPin.style.top = `${anchor.page.y - window.scrollY}px`
   placeCard(card, arrow, anchor, CARD_HEIGHT_ESTIMATE)
   // Once mounted the card knows its height, which decides whether below/above fits.
   requestAnimationFrame(() => {
      placeCard(card, arrow, anchor, card.offsetHeight || CARD_HEIGHT_ESTIMATE)
      textarea.focus()
   })
   return h("div", { class: "composer-root" }, [draftPin, card])
}

function preview(anchor: Anchor, screenshot: CapturedScreenshot | null): HTMLElement[] {
   if (!screenshot) {
      return [
         h("div", { class: "caption is-approximate" }, [
            icon("info", 14),
            h("span", {}, ["The screenshot failed, the squawk is sent without one."])
         ])
      ]
   }
   const clickX = anchor.elementBox.x + anchor.rect.x * anchor.elementBox.width
   const clickY = anchor.elementBox.y + anchor.rect.y * anchor.elementBox.height
   const fraction = { x: clickX / anchor.viewport.width, y: clickY / anchor.viewport.height }
   const marker = h("span", { class: "marker" })
   const image = h("img", { src: screenshot.previewUrl, alt: "Screenshot" })
   const shot = h("div", { class: "composer-shot" }, [image, marker])
   const layout = (): void => cropAroundPin(shot, image, marker, screenshot, fraction)
   layout()
   requestAnimationFrame(layout)
   window.addEventListener("resize", layout, { passive: true })
   const exact = screenshot.source === "extension"
   return [
      shot,
      h("div", { class: `caption${exact ? "" : " is-approximate"}` }, [
         icon(exact ? "image" : "info", 14),
         h("span", {}, [exact ? "Exact screenshot" : "Approximate, install the extension"])
      ])
   ]
}

/**
 * Crops the thumbnail (object-fit: cover) so the pin lands in the middle third of the box and
 * draws the marker where the pinned point ends up. `object-position: p%` puts the image's p%
 * point at the box's p% point, so the position follows from the wanted marker spot.
 */
function cropAroundPin(
   box: HTMLElement,
   image: HTMLImageElement,
   marker: HTMLElement,
   screenshot: CapturedScreenshot,
   fraction: { x: number; y: number }
): void {
   const boxWidth = box.clientWidth
   const boxHeight = box.clientHeight
   if (!boxWidth || !boxHeight) return
   const scale = Math.max(boxWidth / screenshot.width, boxHeight / screenshot.height)
   const x = cropAxis(fraction.x, boxWidth, screenshot.width * scale)
   const y = cropAxis(fraction.y, boxHeight, screenshot.height * scale)
   image.style.objectPosition = `${x.position}% ${y.position}%`
   marker.style.left = `${x.marker}%`
   marker.style.top = `${y.marker}%`
}

/** Object-position and marker spot (both in %) for one axis of the crop. */
function cropAxis(
   fraction: number,
   boxSize: number,
   imageSize: number
): { position: number; marker: number } {
   const slack = boxSize - imageSize
   if (slack >= -0.5) return { position: 50, marker: fraction * 100 }
   const wanted = Math.min(CROP_BIAS_MAX, Math.max(CROP_BIAS_MIN, fraction))
   const position = Math.min(1, Math.max(0, (wanted * boxSize - fraction * imageSize) / slack))
   const marker = (position * slack + fraction * imageSize) / boxSize
   return { position: position * 100, marker: marker * 100 }
}

type Side = "right" | "left" | "bottom" | "top"

interface Candidate {
   side: Side
   left: number
   top: number
}

/**
 * Places the card next to the anchored element: right, left, below or above, whichever comes
 * first without covering the element box, clamped into the viewport. The arrow on the nearest
 * edge points at the pin. Below the sheet breakpoint the CSS takes over.
 */
function placeCard(card: HTMLElement, arrow: HTMLElement, anchor: Anchor, height: number): void {
   if (window.innerWidth <= SHEET_MAX_WIDTH) return
   const clickX = anchor.page.x - window.scrollX
   const clickY = anchor.page.y - window.scrollY
   const box = anchor.elementBox
   const maxLeft = window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN
   const maxTop = window.innerHeight - height - VIEWPORT_MARGIN
   const clampLeft = (left: number): number => Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))
   const clampTop = (top: number): number => Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))
   const candidates: [Candidate, ...Candidate[]] = [
      { side: "right", left: box.x + box.width + CARD_GAP, top: clampTop(clickY - 40) },
      { side: "left", left: box.x - CARD_GAP - CARD_WIDTH, top: clampTop(clickY - 40) },
      {
         side: "bottom",
         left: clampLeft(clickX - CARD_WIDTH / 2),
         top: box.y + box.height + CARD_GAP
      },
      { side: "top", left: clampLeft(clickX - CARD_WIDTH / 2), top: box.y - CARD_GAP - height }
   ]
   const [first] = candidates
   const fits = candidates.find(
      ({ left, top }) =>
         left >= VIEWPORT_MARGIN &&
         left <= maxLeft &&
         top >= VIEWPORT_MARGIN &&
         top <= maxTop &&
         !overlaps({ x: left, y: top, width: CARD_WIDTH, height }, box)
   )
   const chosen = fits ?? { ...first, left: clampLeft(first.left) }
   card.style.left = `${chosen.left}px`
   card.style.top = `${chosen.top}px`
   card.classList.remove("is-right", "is-left", "is-bottom", "is-top")
   card.classList.add(`is-${chosen.side}`)
   arrow.style.top = ""
   arrow.style.left = ""
   if (chosen.side === "right" || chosen.side === "left") {
      const offset = clickY - chosen.top - ARROW_HALF
      arrow.style.top = `${Math.max(ARROW_INSET, Math.min(offset, height - ARROW_INSET))}px`
      return
   }
   const offset = clickX - chosen.left - ARROW_HALF
   arrow.style.left = `${Math.max(ARROW_INSET, Math.min(offset, CARD_WIDTH - ARROW_INSET))}px`
}

interface Box {
   x: number
   y: number
   width: number
   height: number
}

function overlaps(first: Box, second: Box): boolean {
   return (
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y
   )
}
