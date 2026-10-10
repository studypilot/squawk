import type { Squawk } from "@squawk/shared"
import { resolveAnchor } from "../anchor/resolve"
import { h } from "./dom"

export interface PinsLayer {
   element: HTMLElement
   /** Replaces the shown squawks and re-resolves their anchors. */
   show(squawks: Squawk[]): void
   /** Re-resolves the current anchors, e.g. after DOM mutations. */
   refresh(): void
}

interface PinEntry {
   squawk: Squawk
   target: Element | null
   button: HTMLButtonElement
}

/** Numbered pins on the page, kept in place on scroll and resize. */
export function createPinsLayer(onSelect: (squawkId: string) => void): PinsLayer {
   const element = h("div", { class: "pins" })
   let entries: PinEntry[] = []
   let frame = 0

   function resolveEntries(): void {
      for (const entry of entries) {
         const resolved = entry.squawk.anchor ? resolveAnchor(entry.squawk.anchor) : null
         entry.target = resolved?.element ?? null
         entry.button.classList.toggle("is-orphaned", !entry.target)
      }
      position()
   }

   function position(): void {
      for (const { squawk, target, button } of entries) {
         const point = pinPoint(squawk, target)
         button.hidden = !point
         if (point) button.style.transform = `translate(${point.x}px, ${point.y}px)`
      }
   }

   function schedulePosition(): void {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
   }

   window.addEventListener("scroll", schedulePosition, { capture: true, passive: true })
   window.addEventListener("resize", schedulePosition, { passive: true })

   return {
      element,
      show(squawks) {
         entries = squawks.map(squawk => {
            const button = h(
               "button",
               {
                  class: `pin${squawk.status === "resolved" ? " is-resolved" : ""}`,
                  type: "button",
                  title: `#${squawk.number}`,
                  onclick: () => onSelect(squawk.id)
               },
               [String(squawk.number)]
            )
            return { squawk, target: null, button }
         })
         element.replaceChildren(...entries.map(entry => entry.button))
         resolveEntries()
      },
      refresh: resolveEntries
   }
}

/** Viewport position of a pin: on the element if resolved, otherwise at the recorded page point. */
function pinPoint(squawk: Squawk, target: Element | null): { x: number; y: number } | null {
   const anchor = squawk.anchor
   if (!anchor) return null
   if (target?.isConnected) {
      const box = target.getBoundingClientRect()
      return { x: box.left + anchor.rect.x * box.width, y: box.top + anchor.rect.y * box.height }
   }
   return { x: anchor.page.x - window.scrollX, y: anchor.page.y - window.scrollY }
}
