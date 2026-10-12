import type { Squawk } from "@squawk/shared"
import { markdownPreview } from "@squawk/shared"
import { resolveAnchor } from "../anchor/resolve"
import { avatar, h, icon } from "./dom"
import { authorName, relativeTime } from "./format"

export interface PinsHandlers {
   select(squawkId: string): void
   /** The pin under the pointer, or null when it left. */
   hover(squawkId: string | null): void
   /** Squawks whose anchor could not be found on the current page. */
   orphans(squawks: Squawk[]): void
}

export interface PinsLayer {
   element: HTMLElement
   /** Replaces the shown squawks and re-resolves their anchors. */
   show(squawks: Squawk[]): void
   /** Re-resolves the current anchors, e.g. after DOM mutations. */
   refresh(): void
   /** Highlights the pin of the open thread. */
   select(squawkId: string | null): void
}

interface PinEntry {
   squawk: Squawk
   target: Element | null
   button: HTMLButtonElement
}

const TIP_WIDTH = 240
const TIP_GAP = 10
const VIEWPORT_MARGIN = 8

/** Numbered pins on the page, kept in place on scroll and resize, with a hover card. */
export function createPinsLayer(handlers: PinsHandlers): PinsLayer {
   const tip = h("div", { class: "pin-tip" })
   const element = h("div", { class: "pins" }, [tip])
   let entries: PinEntry[] = []
   let selectedId: string | null = null
   let frame = 0

   function resolveEntries(): void {
      const orphans: Squawk[] = []
      for (const entry of entries) {
         const resolved = entry.squawk.anchor ? resolveAnchor(entry.squawk.anchor) : null
         entry.target = resolved?.element ?? null
         if (entry.squawk.anchor && !entry.target) orphans.push(entry.squawk)
      }
      handlers.orphans(orphans)
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

   function showTip(entry: PinEntry): void {
      const { squawk } = entry
      tip.replaceChildren(
         avatar(squawk.author, 24),
         h("div", { class: "pin-tip-text" }, [
            h("div", { class: "pin-tip-head" }, [
               h("span", { class: "name" }, [authorName(squawk.author)]),
               h("span", { class: "muted" }, [relativeTime(squawk.createdAt)])
            ]),
            h("div", { class: "pin-tip-body" }, [markdownPreview(squawk.body)])
         ])
      )
      const box = entry.button.getBoundingClientRect()
      const maxLeft = element.clientWidth - TIP_WIDTH - VIEWPORT_MARGIN
      const left = Math.max(
         VIEWPORT_MARGIN,
         Math.min(box.left + box.width / 2 - TIP_WIDTH / 2, maxLeft)
      )
      tip.style.left = `${left}px`
      tip.style.top = ""
      tip.style.bottom = ""
      tip.classList.add("is-visible")
      const height = tip.offsetHeight
      if (box.top - TIP_GAP - height >= VIEWPORT_MARGIN) {
         tip.style.top = `${box.top - TIP_GAP - height}px`
      } else {
         tip.style.top = `${box.bottom + TIP_GAP}px`
      }
   }

   function hideTip(): void {
      tip.classList.remove("is-visible")
   }

   window.addEventListener("scroll", schedulePosition, { capture: true, passive: true })
   window.addEventListener("resize", schedulePosition, { passive: true })

   return {
      element,
      show(squawks) {
         hideTip()
         entries = squawks.map(squawk => {
            const resolved = squawk.status === "resolved"
            const button = h(
               "button",
               {
                  class: `pin${resolved ? " is-resolved" : ""}`,
                  type: "button",
                  title: `#${squawk.number}`,
                  "aria-label": `Squawk #${squawk.number}`,
                  onclick: () => handlers.select(squawk.id)
               },
               [h("span", {}, [resolved ? icon("check", 12) : String(squawk.number)])]
            )
            const entry: PinEntry = { squawk, target: null, button }
            button.addEventListener("pointerenter", event => {
               if (event.pointerType === "touch") return
               showTip(entry)
               handlers.hover(squawk.id)
            })
            button.addEventListener("pointerleave", () => {
               hideTip()
               handlers.hover(null)
            })
            button.classList.toggle("is-selected", squawk.id === selectedId)
            return entry
         })
         element.replaceChildren(...entries.map(entry => entry.button), tip)
         resolveEntries()
      },
      refresh: resolveEntries,
      select(squawkId) {
         selectedId = squawkId
         for (const entry of entries) {
            entry.button.classList.toggle("is-selected", entry.squawk.id === squawkId)
         }
      }
   }
}

/** Viewport position of a pin on its element; orphaned pins are listed in the panel instead. */
function pinPoint(squawk: Squawk, target: Element | null): { x: number; y: number } | null {
   const anchor = squawk.anchor
   if (!anchor || !target?.isConnected) return null
   const box = target.getBoundingClientRect()
   return { x: box.left + anchor.rect.x * box.width, y: box.top + anchor.rect.y * box.height }
}
