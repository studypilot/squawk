import { h } from "./dom"
import type { PinLocation } from "./pins"
import { placeBeside } from "./placement"

export interface ThreadPopover {
   element: HTMLElement
   /** Shows `content` next to the pin `locate` reports; follows it on scroll and resize. */
   show(content: HTMLElement, locate: () => PinLocation | null, rightInset: number): void
   hide(): void
   isOpen(): boolean
}

const WIDTH = 340
/** Used until the card is in the DOM and can report its real height. */
const HEIGHT_ESTIMATE = 320

/**
 * The open thread anchored next to its pin, like a comment popover in a design tool. Calls
 * `onLost` when the pin disappears (navigation, DOM change), so the owner can close it.
 */
export function createThreadPopover(onLost: () => void): ThreadPopover {
   const element = h("div", {
      class: "thread-popover",
      role: "dialog",
      "aria-label": "Squawk thread",
      tabindex: "-1",
      hidden: true
   })
   let locate: (() => PinLocation | null) | null = null
   let inset = 0
   let frame = 0

   function position(): void {
      if (!locate) return
      const location = locate()
      if (!location) {
         onLost()
         return
      }
      const placed = placeBeside({
         avoid: location.avoid,
         point: location.point,
         width: WIDTH,
         height: element.offsetHeight || HEIGHT_ESTIMATE,
         bounds: { x: 0, y: 0, width: window.innerWidth - inset, height: window.innerHeight }
      })
      element.style.left = `${placed.left}px`
      element.style.top = `${placed.top}px`
      element.dataset.side = placed.side
   }

   function schedule(): void {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
   }

   // The content grows when the thread loads; keep the card inside the viewport.
   const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null

   return {
      element,
      show(content, nextLocate, rightInset) {
         const opening = element.hidden
         locate = nextLocate
         inset = rightInset
         if (element.firstChild !== content) element.replaceChildren(content)
         element.hidden = false
         if (opening) {
            window.addEventListener("scroll", schedule, { capture: true, passive: true })
            window.addEventListener("resize", schedule, { passive: true })
            resizeObserver?.observe(element)
            element.focus({ preventScroll: true })
         }
         position()
      },
      hide() {
         if (element.hidden) return
         cancelAnimationFrame(frame)
         locate = null
         element.hidden = true
         element.replaceChildren()
         window.removeEventListener("scroll", schedule, { capture: true })
         window.removeEventListener("resize", schedule)
         resizeObserver?.disconnect()
      },
      isOpen: () => !element.hidden
   }
}
