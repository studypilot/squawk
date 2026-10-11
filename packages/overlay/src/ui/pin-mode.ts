import { anchorTarget } from "../anchor/capture"
import { uniqueTestId } from "../anchor/test-id"
import { h } from "./dom"

export interface PinModeHandlers {
   pick(element: Element, clientX: number, clientY: number): void
   cancel(): void
}

export interface PinMode {
   element: HTMLElement
   start(): void
   stop(): void
}

/** Below this distance from the top edge the chip moves inside the outline. */
const CHIP_CLEARANCE = 28

/**
 * A transparent full-screen layer with a crosshair cursor. It finds the page element below the
 * pointer by briefly disabling its own pointer events and asking `elementFromPoint`.
 */
export function createPinMode(overlayHost: HTMLElement, handlers: PinModeHandlers): PinMode {
   const chip = h("span", { class: "highlight-chip" })
   const highlight = h("div", { class: "highlight", hidden: true }, [chip])
   const hint = h("div", { class: "pin-hint" }, [
      "Click an element to pin a squawk",
      h("kbd", {}, ["Esc"])
   ])
   const layer = h("div", { class: "pin-layer" })
   const element = h("div", { class: "pin-mode", hidden: true }, [layer, highlight, hint])
   let frame = 0

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

   layer.addEventListener("pointermove", event => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => showHighlight(event.clientX, event.clientY))
   })
   layer.addEventListener("pointerdown", event => showHighlight(event.clientX, event.clientY))
   layer.addEventListener("click", event => {
      event.preventDefault()
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
         window.addEventListener("keydown", onKeyDown, true)
      },
      stop() {
         cancelAnimationFrame(frame)
         element.hidden = true
         window.removeEventListener("keydown", onKeyDown, true)
      }
   }
}
