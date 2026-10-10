import { anchorTarget } from "../anchor/capture"
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

/**
 * A transparent full-screen layer with a crosshair cursor. It finds the page element below the
 * pointer by briefly disabling its own pointer events and asking `elementFromPoint`.
 */
export function createPinMode(overlayHost: HTMLElement, handlers: PinModeHandlers): PinMode {
   const highlight = h("div", { class: "highlight", hidden: true })
   const hint = h("div", { class: "pin-hint" }, ["Click an element to pin a squawk. Esc cancels."])
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
      const box = anchorTarget(found).getBoundingClientRect()
      Object.assign(highlight.style, {
         left: `${box.left}px`,
         top: `${box.top}px`,
         width: `${box.width}px`,
         height: `${box.height}px`
      })
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
