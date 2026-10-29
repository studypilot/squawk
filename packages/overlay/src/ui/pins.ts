import type { Squawk } from "@squawk/shared"
import { markdownPreview } from "@squawk/shared"
import { areaOnElement } from "../anchor/area"
import { resolveAnchor } from "../anchor/resolve"
import { avatar, h, icon } from "./dom"
import { authorName, relativeTime } from "./format"
import type { Box } from "./placement"

export interface PinLocation {
   /** What a card must not cover: the pin, plus the area of an area squawk. */
   avoid: Box
   /** The pin's foot on the page, where a card lines up. */
   point: { x: number; y: number }
}

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
   /** Raises the pin of the open thread. */
   select(squawkId: string | null): void
   /** Highlights a pin while its list row is hovered. */
   highlight(squawkId: string | null): void
   /** Where a shown pin (and its area) is in the viewport, or null when it is not on the page. */
   locate(squawkId: string): PinLocation | null
   /** Scrolls the page so the pin is in view, unless it already is. */
   reveal(squawkId: string): void
}

interface PinEntry {
   squawk: Squawk
   target: Element | null
   button: HTMLButtonElement
   /** The outlined rectangle of an area squawk. */
   area: HTMLElement | null
}

const PIN_SIZE = 24
const TIP_WIDTH = 240
const TIP_GAP = 10
const VIEWPORT_MARGIN = 8

/** Numbered pins on the page, kept in place on scroll and resize, with a hover card. */
export function createPinsLayer(handlers: PinsHandlers): PinsLayer {
   const tip = h("div", { class: "pin-tip", "aria-hidden": "true" })
   const element = h("div", { class: "pins" }, [tip])
   let entries: PinEntry[] = []
   let selectedId: string | null = null
   let highlightedId: string | null = null
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
      for (const { squawk, target, button, area } of entries) {
         const point = pinPoint(squawk, target)
         button.hidden = !point
         if (point) button.style.transform = `translate(${point.x}px, ${point.y}px)`
         if (!area) continue
         const box = areaBox(squawk, target)
         area.hidden = !box
         if (box) {
            Object.assign(area.style, {
               left: `${box.x}px`,
               top: `${box.y}px`,
               width: `${box.width}px`,
               height: `${box.height}px`
            })
         }
      }
   }

   function schedulePosition(): void {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
   }

   function showTip(entry: PinEntry): void {
      const { squawk } = entry
      const draft = squawk.status === "draft"
      tip.replaceChildren(
         avatar(squawk.author, 24),
         h("div", { class: "pin-tip-text" }, [
            h("div", { class: "pin-tip-head" }, [
               h("span", { class: "name" }, [draft ? "Your draft" : authorName(squawk.author)]),
               h("span", { class: "muted" }, [
                  draft ? "not sent yet" : relativeTime(squawk.createdAt)
               ])
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

   function applyClasses(): void {
      for (const { squawk, button, area } of entries) {
         for (const node of [button, area]) {
            node?.classList.toggle("is-selected", squawk.id === selectedId)
            node?.classList.toggle("is-highlighted", squawk.id === highlightedId)
         }
      }
   }

   window.addEventListener("scroll", schedulePosition, { capture: true, passive: true })
   window.addEventListener("resize", schedulePosition, { passive: true })

   return {
      element,
      show(squawks) {
         hideTip()
         entries = squawks.map(squawk => {
            const resolved = squawk.status === "resolved"
            const draft = squawk.status === "draft"
            const label = draft
               ? `Draft #${squawk.number}, not sent yet`
               : [
                    `Squawk #${squawk.number} by ${authorName(squawk.author)}`,
                    squawk.unread && "unread",
                    squawk.working && `${authorName(squawk.working.by)} is working on it`
                 ]
                    .filter(Boolean)
                    .join(", ")
            const classes = [
               "pin",
               resolved && "is-resolved",
               draft && "is-draft",
               squawk.unread && "is-unread",
               squawk.working && "is-working"
            ]
            const button = h(
               "button",
               {
                  class: classes.filter(Boolean).join(" "),
                  type: "button",
                  "aria-label": label,
                  onclick: () => {
                     hideTip()
                     handlers.select(squawk.id)
                  }
               },
               [h("span", {}, [resolved ? icon("check", 12) : String(squawk.number)])]
            )
            const area = squawk.anchor?.area
               ? h("div", {
                    class: ["pin-area", resolved && "is-resolved", draft && "is-draft"]
                       .filter(Boolean)
                       .join(" "),
                    hidden: true
                 })
               : null
            const entry: PinEntry = { squawk, target: null, button, area }
            button.addEventListener("pointerenter", event => {
               if (event.pointerType === "touch") return
               showTip(entry)
               handlers.hover(squawk.id)
            })
            button.addEventListener("pointerleave", () => {
               hideTip()
               handlers.hover(null)
            })
            return entry
         })
         applyClasses()
         element.replaceChildren(
            ...entries.flatMap(entry => (entry.area ? [entry.area] : [])),
            ...entries.map(entry => entry.button),
            tip
         )
         resolveEntries()
      },
      refresh: resolveEntries,
      select(squawkId) {
         selectedId = squawkId
         applyClasses()
      },
      highlight(squawkId) {
         highlightedId = squawkId
         applyClasses()
      },
      locate(squawkId) {
         const entry = entries.find(candidate => candidate.squawk.id === squawkId)
         if (!entry) return null
         const point = pinPoint(entry.squawk, entry.target)
         if (!point) return null
         const pin = { x: point.x, y: point.y - PIN_SIZE, width: PIN_SIZE, height: PIN_SIZE }
         const area = areaBox(entry.squawk, entry.target)
         return { avoid: area ? union(pin, area) : pin, point }
      },
      reveal(squawkId) {
         const entry = entries.find(candidate => candidate.squawk.id === squawkId)
         const point = entry ? pinPoint(entry.squawk, entry.target) : null
         if (!entry?.target || !point) return
         const inView = point.y > PIN_SIZE * 2 && point.y < window.innerHeight - PIN_SIZE * 2
         if (inView) return
         const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
         entry.target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" })
      }
   }
}

/** Viewport box of an area squawk's rectangle, scaled with its element. */
function areaBox(squawk: Squawk, target: Element | null): Box | null {
   const anchor = squawk.anchor
   if (!anchor?.area || !target?.isConnected) return null
   const box = target.getBoundingClientRect()
   return areaOnElement(anchor, { x: box.left, y: box.top, width: box.width, height: box.height })
}

function union(first: Box, second: Box): Box {
   const x = Math.min(first.x, second.x)
   const y = Math.min(first.y, second.y)
   return {
      x,
      y,
      width: Math.max(first.x + first.width, second.x + second.width) - x,
      height: Math.max(first.y + first.height, second.y + second.height) - y
   }
}

/** Viewport position of a pin on its element; orphaned pins are listed in the panel instead. */
function pinPoint(squawk: Squawk, target: Element | null): { x: number; y: number } | null {
   const anchor = squawk.anchor
   if (!anchor || !target?.isConnected) return null
   const box = target.getBoundingClientRect()
   return { x: box.left + anchor.rect.x * box.width, y: box.top + anchor.rect.y * box.height }
}
