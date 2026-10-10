import { LIMITS } from "@squawk/shared"
import type { Anchor } from "@squawk/shared"
import type { CapturedScreenshot } from "../screenshot"
import { h } from "./dom"

export interface ComposerOptions {
   anchor: Anchor
   screenshot: CapturedScreenshot | null
   submit(body: string): Promise<void>
   close(): void
}

const CARD_WIDTH = 340
const CARD_GAP = 16
const VIEWPORT_MARGIN = 12
/** Typical rendered height with a landscape thumbnail; only used to keep the card on screen. */
const CARD_HEIGHT_ESTIMATE = 400

/** Card with screenshot preview, comment field and Cancel / Send, placed next to the pin. */
export function createComposer(options: ComposerOptions): HTMLElement {
   const { anchor, screenshot } = options
   const textarea = h("textarea", {
      placeholder: "What should change here?",
      maxlength: LIMITS.bodyMaxLength,
      rows: 4
   })
   const error = h("div", { class: "error", hidden: true })
   const sendButton = h("button", { class: "button primary", type: "button" }, ["Send"])
   const cancelButton = h(
      "button",
      { class: "button", type: "button", onclick: () => options.close() },
      ["Cancel"]
   )

   async function send(): Promise<void> {
      const body = textarea.value.trim()
      if (!body || sendButton.disabled) return
      sendButton.disabled = true
      error.hidden = true
      try {
         await options.submit(body)
         options.close()
      } catch (failure) {
         error.textContent = failure instanceof Error ? failure.message : "Sending failed"
         error.hidden = false
         sendButton.disabled = false
      }
   }

   sendButton.addEventListener("click", () => void send())
   textarea.addEventListener("keydown", event => {
      if (event.key === "Escape") options.close()
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send()
   })

   const card = h("div", { class: "composer", role: "dialog", "aria-label": "New squawk" }, [
      preview(anchor, screenshot),
      textarea,
      error,
      h("div", { class: "actions" }, [cancelButton, sendButton])
   ])
   placeCard(card, anchor)
   requestAnimationFrame(() => textarea.focus())
   return card
}

function preview(anchor: Anchor, screenshot: CapturedScreenshot | null): HTMLElement {
   if (!screenshot) {
      return h("div", { class: "note" }, ["The screenshot failed. The squawk is sent without one."])
   }
   const clickX = anchor.elementBox.x + anchor.rect.x * anchor.elementBox.width
   const clickY = anchor.elementBox.y + anchor.rect.y * anchor.elementBox.height
   const marker = h("span", { class: "marker" })
   marker.style.left = `${(clickX / anchor.viewport.width) * 100}%`
   marker.style.top = `${(clickY / anchor.viewport.height) * 100}%`
   const image = h("img", { src: screenshot.previewUrl, alt: "Screenshot" })
   return h("div", { class: "preview" }, [
      h("div", { class: "thumb" }, [image, marker]),
      screenshot.source === "dom" &&
         h("div", { class: "note" }, [
            "Approximate screenshot — install the Squawk extension for exact captures."
         ])
   ])
}

/** Right of the click point if it fits, otherwise left; clamped into the viewport. */
function placeCard(card: HTMLElement, anchor: Anchor): void {
   const clickX = anchor.page.x - window.scrollX
   const clickY = anchor.page.y - window.scrollY
   const fitsRight = clickX + CARD_GAP + CARD_WIDTH <= window.innerWidth - VIEWPORT_MARGIN
   const left = fitsRight ? clickX + CARD_GAP : clickX - CARD_GAP - CARD_WIDTH
   const maxLeft = window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN
   card.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`
   const maxTop = window.innerHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN
   card.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(clickY - 40, maxTop))}px`
}
