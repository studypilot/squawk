import type { AnchorBox } from "@squawk/shared"
import { anchorTarget, areaTarget } from "../anchor/capture"
import { uniqueTestId } from "../anchor/test-id"
import { h } from "./dom"

export interface PinModeHandlers {
   pick(element: Element, clientX: number, clientY: number): void
   /** `element` is the smallest element containing `area` (viewport coordinates). */
   pickArea(element: Element, area: AnchorBox): void
   cancel(): void
}

export interface PinMode {
   element: HTMLElement
   start(): void
   stop(): void
}

/** Below this distance from the top edge the chip moves inside the outline. */
const CHIP_CLEARANCE = 28
/** Pointer travel before a press turns into dragging an area. */
const DRAG_SLOP = 6
/** Smaller rectangles are taken for a slipped click and dropped. */
const MIN_AREA_SIZE = 8
/** A finger rests this long before it draws an area; a quick swipe scrolls the page instead. */
const TOUCH_HOLD_MS = 400

interface Press {
   pointerId: number
   touch: boolean
   startX: number
   startY: number
   x: number
   y: number
   dragging: boolean
   holdTimer: ReturnType<typeof setTimeout> | null
}

/**
 * A transparent full-screen layer with a crosshair cursor. It finds the page element below the
 * pointer by briefly disabling its own pointer events and asking `elementFromPoint`. A click
 * pins an element; dragging (on touch: holding still first, then dragging) draws an area.
 */
export function createPinMode(overlayHost: HTMLElement, handlers: PinModeHandlers): PinMode {
   const chip = h("span", { class: "highlight-chip" })
   const highlight = h("div", { class: "highlight", hidden: true }, [chip])
   const areaChip = h("span", { class: "area-chip" })
   const areaDraw = h("div", { class: "area-draw", hidden: true }, [areaChip])
   const hint = h("div", { class: "pin-hint" }, [
      h("span", { class: "pin-hint-fine" }, ["Click an element or drag an area"]),
      h("span", { class: "pin-hint-coarse" }, ["Tap an element, or hold and drag an area"]),
      h("kbd", {}, ["Esc"])
   ])
   const layer = h("div", { class: "pin-layer" })
   const element = h("div", { class: "pin-mode", hidden: true }, [layer, highlight, areaDraw, hint])
   let frame = 0
   let press: Press | null = null
   let suppressClick = false

   function pageElementAt(clientX: number, clientY: number): Element | null {
      layer.style.pointerEvents = "none"
      const found = document.elementFromPoint(clientX, clientY)
      layer.style.pointerEvents = ""
      if (!found || found === overlayHost || found === document.documentElement) return null
      return found
   }

   function showHighlight(clientX: number, clientY: number): void {
      const found = pageElementAt(clientX, clientY)
      highlight.hidden = !found
      if (!found) return
      const target = anchorTarget(found)
      const box = target.getBoundingClientRect()
      Object.assign(highlight.style, {
         left: `${box.left}px`,
         top: `${box.top}px`,
         width: `${box.width}px`,
         height: `${box.height}px`
      })
      highlight.classList.toggle("is-near-top", box.top < CHIP_CLEARANCE)
      chip.textContent = uniqueTestId(target) ?? target.localName
   }

   function pressedArea(current: Press): AnchorBox {
      const maxX = window.innerWidth
      const maxY = window.innerHeight
      const clampX = (value: number): number => Math.max(0, Math.min(value, maxX))
      const clampY = (value: number): number => Math.max(0, Math.min(value, maxY))
      const left = clampX(Math.min(current.startX, current.x))
      const top = clampY(Math.min(current.startY, current.y))
      const right = clampX(Math.max(current.startX, current.x))
      const bottom = clampY(Math.max(current.startY, current.y))
      return { x: left, y: top, width: right - left, height: bottom - top }
   }

   function drawArea(current: Press): void {
      const area = pressedArea(current)
      Object.assign(areaDraw.style, {
         left: `${area.x}px`,
         top: `${area.y}px`,
         width: `${area.width}px`,
         height: `${area.height}px`
      })
      areaDraw.classList.toggle("is-near-top", area.y < CHIP_CLEARANCE)
      areaChip.textContent = `${Math.round(area.width)} × ${Math.round(area.height)}`
      areaDraw.hidden = false
   }

   function startDrag(current: Press): void {
      current.dragging = true
      clearHold(current)
      cancelAnimationFrame(frame)
      highlight.hidden = true
      try {
         layer.setPointerCapture(current.pointerId)
      } catch {
         // Pointer capture is a nicety; the layer covers the viewport anyway.
      }
      drawArea(current)
   }

   function clearHold(current: Press): void {
      if (current.holdTimer !== null) clearTimeout(current.holdTimer)
      current.holdTimer = null
   }

   function endPress(): void {
      if (press) clearHold(press)
      press = null
      areaDraw.hidden = true
   }

   function finishDrag(current: Press): void {
      const area = pressedArea(current)
      endPress()
      suppressClick = true
      if (area.width < MIN_AREA_SIZE || area.height < MIN_AREA_SIZE) return
      const centre = pageElementAt(area.x + area.width / 2, area.y + area.height / 2)
      handlers.pickArea(areaTarget(centre ?? document.body, area), area)
   }

   layer.addEventListener("pointerdown", event => {
      if (press || (event.pointerType === "mouse" && event.button !== 0)) return
      const current: Press = {
         pointerId: event.pointerId,
         touch: event.pointerType === "touch",
         startX: event.clientX,
         startY: event.clientY,
         x: event.clientX,
         y: event.clientY,
         dragging: false,
         holdTimer: null
      }
      press = current
      suppressClick = false
      if (current.touch) current.holdTimer = setTimeout(() => startDrag(current), TOUCH_HOLD_MS)
      showHighlight(event.clientX, event.clientY)
   })

   layer.addEventListener("pointermove", event => {
      const current = press
      if (!current || current.pointerId !== event.pointerId) {
         if (current) return
         cancelAnimationFrame(frame)
         frame = requestAnimationFrame(() => showHighlight(event.clientX, event.clientY))
         return
      }
      current.x = event.clientX
      current.y = event.clientY
      if (current.dragging) return drawArea(current)
      const moved = Math.hypot(current.x - current.startX, current.y - current.startY)
      if (moved < DRAG_SLOP) return
      // A finger that moves before the hold is over is scrolling; the browser takes it from here.
      if (current.touch) return clearHold(current)
      startDrag(current)
   })

   layer.addEventListener("pointerup", event => {
      const current = press
      if (!current || current.pointerId !== event.pointerId) return
      current.x = event.clientX
      current.y = event.clientY
      if (current.dragging) return finishDrag(current)
      endPress()
   })

   layer.addEventListener("pointercancel", () => endPress())
   // While an area is being drawn the finger must not scroll the page. The listener is passive
   // otherwise, so plain swipes still scroll.
   layer.addEventListener(
      "touchmove",
      event => {
         if (press?.dragging) event.preventDefault()
      },
      { passive: false }
   )
   layer.addEventListener("contextmenu", event => event.preventDefault())
   layer.addEventListener("click", event => {
      event.preventDefault()
      if (suppressClick) {
         suppressClick = false
         return
      }
      const found = pageElementAt(event.clientX, event.clientY)
      if (found) handlers.pick(found, event.clientX, event.clientY)
   })

   const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      handlers.cancel()
   }

   return {
      element,
      start() {
         element.hidden = false
         highlight.hidden = true
         suppressClick = false
         window.addEventListener("keydown", onKeyDown, true)
      },
      stop() {
         cancelAnimationFrame(frame)
         endPress()
         element.hidden = true
         window.removeEventListener("keydown", onKeyDown, true)
      }
   }
}
