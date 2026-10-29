import { LIMITS } from "@squawk/shared"
import type { Anchor } from "@squawk/shared"
import { capturedPoint } from "../anchor/area"
import type { CapturedScreenshot } from "../screenshot"
import { autoGrow, h, icon, spinner } from "./dom"
import { isNarrowViewport, placeBeside } from "./placement"

/** `draft` adds the squawk to the user's review, `now` sends it to everyone right away. */
export type SubmitMode = "draft" | "now"

export interface ComposerOptions {
   anchor: Anchor
   screenshot: CapturedScreenshot | null
   submit(body: string, mode: SubmitMode): Promise<void>
   close(): void
}

export interface Composer {
   element: HTMLElement
   close(): void
}

const CARD_WIDTH = 360
const ARROW_INSET = 22
const ARROW_HALF = 6
/** Used until the card is in the DOM and can report its real height. */
const CARD_HEIGHT_ESTIMATE = 400
/** The pin (or the centre of the area) is kept inside the middle third of the thumbnail crop. */
const CROP_BIAS_MIN = 1 / 3
const CROP_BIAS_MAX = 2 / 3

/**
 * Card with screenshot preview, comment field and the two ways to file it, placed next to the
 * pin with an arrow pointing at it. Enter adds the squawk to the review, Cmd/Ctrl+Enter sends it
 * right away, Shift+Enter breaks the line. The wrapper also carries the new pin on the page,
 * and the outlined area for an area squawk.
 */
export function createComposer(options: ComposerOptions): Composer {
   const { anchor, screenshot } = options
   const textarea = h("textarea", {
      placeholder: "What should change here?",
      "aria-label": "Comment",
      maxlength: LIMITS.bodyMaxLength
   })
   autoGrow(textarea, 2, 6)
   const error = h("div", { class: "error", role: "alert", hidden: true })
   const draftButton = h(
      "button",
      { class: "button primary", type: "button", title: "Add to your review (Enter)" },
      [h("span", {}, ["Add to review"]), h("kbd", {}, ["↵"]), spinner()]
   )
   const nowButton = h(
      "button",
      {
         class: "button ghost send-now",
         type: "button",
         title: "Send to everyone now, without a review (⌘/Ctrl+Enter)"
      },
      [icon("send", 14), h("span", {}, ["Send now"]), spinner()]
   )
   const cancelButton = h(
      "button",
      { class: "button ghost", type: "button", onclick: () => options.close() },
      ["Cancel"]
   )
   const controls = [textarea, draftButton, nowButton, cancelButton]

   function setBusy(button: HTMLButtonElement | null): void {
      for (const control of controls) control.disabled = button !== null
      for (const candidate of [draftButton, nowButton]) {
         const busy = candidate === button
         candidate.classList.toggle("is-busy", busy)
         if (busy) candidate.setAttribute("aria-busy", "true")
         else candidate.removeAttribute("aria-busy")
      }
   }

   async function send(mode: SubmitMode): Promise<void> {
      const body = textarea.value.trim()
      if (textarea.disabled) return
      if (!body) {
         textarea.focus()
         return
      }
      setBusy(mode === "draft" ? draftButton : nowButton)
      error.hidden = true
      try {
         await options.submit(body, mode)
         options.close()
      } catch (failure) {
         error.textContent = failure instanceof Error ? failure.message : "Sending failed"
         error.hidden = false
         setBusy(null)
         textarea.focus()
      }
   }

   draftButton.addEventListener("click", () => void send("draft"))
   nowButton.addEventListener("click", () => void send("now"))
   textarea.addEventListener("keydown", event => {
      if (event.key === "Escape") {
         event.preventDefault()
         options.close()
         return
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
      event.preventDefault()
      void send(event.metaKey || event.ctrlKey ? "now" : "draft")
   })

   const arrow = h("span", { class: "composer-arrow" })
   const card = h("div", { class: "composer", role: "dialog", "aria-label": "New squawk" }, [
      arrow,
      ...preview(anchor, screenshot),
      textarea,
      error,
      h("div", { class: "composer-footer" }, [
         nowButton,
         h("span", { class: "spacer" }),
         cancelButton,
         draftButton
      ])
   ])
   const newPin = h("span", { class: "composer-pin", "aria-hidden": "true" })
   newPin.style.left = `${anchor.page.x - window.scrollX}px`
   newPin.style.top = `${anchor.page.y - window.scrollY}px`
   const marks = [newPin]
   if (anchor.area) {
      const newArea = h("span", { class: "composer-area", "aria-hidden": "true" })
      Object.assign(newArea.style, {
         left: `${anchor.area.x}px`,
         top: `${anchor.area.y}px`,
         width: `${anchor.area.width}px`,
         height: `${anchor.area.height}px`
      })
      marks.unshift(newArea)
   }
   placeCard(card, arrow, anchor, CARD_HEIGHT_ESTIMATE)
   // Once mounted the card knows its height, which decides whether below/above fits.
   requestAnimationFrame(() => {
      placeCard(card, arrow, anchor, card.offsetHeight || CARD_HEIGHT_ESTIMATE)
      textarea.focus()
   })
   return {
      element: h("div", { class: "composer-root" }, [...marks, card]),
      close: () => options.close()
   }
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
   const marker = h("span", { class: anchor.area ? "marker-area" : "marker" })
   const image = h("img", { src: screenshot.previewUrl, alt: "Screenshot" })
   const shot = h("div", { class: "composer-shot" }, [image, marker])
   const layout = (): void => cropAroundPin(shot, image, marker, screenshot, anchor)
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
 * Crops the thumbnail (object-fit: cover) so the pin, or the centre of the area, lands in the
 * middle third of the box and draws the marker where the pinned spot ends up. `object-position:
 * p%` puts the image's p% point at the box's p% point, so the position follows from the wanted
 * marker spot.
 */
function cropAroundPin(
   box: HTMLElement,
   image: HTMLImageElement,
   marker: HTMLElement,
   screenshot: CapturedScreenshot,
   anchor: Anchor
): void {
   const boxWidth = box.clientWidth
   const boxHeight = box.clientHeight
   if (!boxWidth || !boxHeight) return
   const { width, height } = anchor.viewport
   const { area } = anchor
   const focus = area
      ? { x: (area.x + area.width / 2) / width, y: (area.y + area.height / 2) / height }
      : { x: capturedPoint(anchor).x / width, y: capturedPoint(anchor).y / height }
   const scale = Math.max(boxWidth / screenshot.width, boxHeight / screenshot.height)
   const x = cropAxis(focus.x, boxWidth, screenshot.width * scale)
   const y = cropAxis(focus.y, boxHeight, screenshot.height * scale)
   image.style.objectPosition = `${x.position}% ${y.position}%`
   if (area) {
      const left = x.place(area.x / width)
      const top = y.place(area.y / height)
      marker.style.left = `${left}%`
      marker.style.top = `${top}%`
      marker.style.width = `${x.place((area.x + area.width) / width) - left}%`
      marker.style.height = `${y.place((area.y + area.height) / height) - top}%`
      return
   }
   marker.style.left = `${x.place(focus.x)}%`
   marker.style.top = `${y.place(focus.y)}%`
}

/**
 * One axis of the crop: the object-position (in %) that brings `focus` into the middle third,
 * and `place`, which maps any fraction of the image to its spot in the box (in %).
 */
function cropAxis(
   focus: number,
   boxSize: number,
   imageSize: number
): { position: number; place(fraction: number): number } {
   const slack = boxSize - imageSize
   if (slack >= -0.5) return { position: 50, place: fraction => fraction * 100 }
   const wanted = Math.min(CROP_BIAS_MAX, Math.max(CROP_BIAS_MIN, focus))
   const position = Math.min(1, Math.max(0, (wanted * boxSize - focus * imageSize) / slack))
   return {
      position: position * 100,
      place: fraction => ((position * slack + fraction * imageSize) / boxSize) * 100
   }
}

/**
 * Places the card next to the anchored element with the arrow on the nearest edge pointing at
 * the pin. Below the sheet breakpoint the CSS takes over.
 */
function placeCard(card: HTMLElement, arrow: HTMLElement, anchor: Anchor, height: number): void {
   if (isNarrowViewport()) return
   const point = { x: anchor.page.x - window.scrollX, y: anchor.page.y - window.scrollY }
   const chosen = placeBeside({
      avoid: anchor.area ?? anchor.elementBox,
      point,
      width: CARD_WIDTH,
      height,
      bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
   })
   card.style.left = `${chosen.left}px`
   card.style.top = `${chosen.top}px`
   card.classList.remove("is-right", "is-left", "is-bottom", "is-top")
   card.classList.add(`is-${chosen.side}`)
   arrow.style.top = ""
   arrow.style.left = ""
   if (chosen.side === "right" || chosen.side === "left") {
      const offset = point.y - chosen.top - ARROW_HALF
      arrow.style.top = `${Math.max(ARROW_INSET, Math.min(offset, height - ARROW_INSET))}px`
      return
   }
   const offset = point.x - chosen.left - ARROW_HALF
   arrow.style.left = `${Math.max(ARROW_INSET, Math.min(offset, CARD_WIDTH - ARROW_INSET))}px`
}
