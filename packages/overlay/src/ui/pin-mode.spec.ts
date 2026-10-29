import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinMode } from "./pin-mode"
import type { PinModeHandlers } from "./pin-mode"

interface PointerInit {
   x: number
   y: number
   pointerType?: string
   pointerId?: number
   button?: number
}

/** jsdom has no PointerEvent; a MouseEvent with the pointer fields added stands in. */
function pointer(type: string, init: PointerInit): Event {
   const event = new MouseEvent(type, {
      clientX: init.x,
      clientY: init.y,
      button: init.button ?? 0,
      bubbles: true,
      cancelable: true
   })
   Object.defineProperties(event, {
      pointerId: { value: init.pointerId ?? 1 },
      pointerType: { value: init.pointerType ?? "mouse" }
   })
   return event
}

function setBox(element: Element, box: { x: number; y: number; width: number; height: number }) {
   vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      ...box,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON: () => ({})
   } as DOMRect)
}

let handlers: {
   pick: ReturnType<typeof vi.fn<PinModeHandlers["pick"]>>
   pickArea: ReturnType<typeof vi.fn<PinModeHandlers["pickArea"]>>
   cancel: ReturnType<typeof vi.fn<PinModeHandlers["cancel"]>>
}
let layer: HTMLElement
let target: HTMLElement

function setup(): void {
   document.body.innerHTML = `<main><section><p id="target">Hello</p></section></main>`
   target = document.getElementById("target") as HTMLElement
   setBox(document.body, { x: 0, y: 0, width: 1000, height: 1000 })
   setBox(document.querySelector("main") as Element, { x: 0, y: 0, width: 800, height: 600 })
   setBox(document.querySelector("section") as Element, { x: 0, y: 100, width: 400, height: 200 })
   setBox(target, { x: 20, y: 120, width: 100, height: 20 })
   document.elementFromPoint = vi.fn(() => target)
   const host = document.createElement("div")
   handlers = {
      pick: vi.fn<PinModeHandlers["pick"]>(),
      pickArea: vi.fn<PinModeHandlers["pickArea"]>(),
      cancel: vi.fn<PinModeHandlers["cancel"]>()
   }
   const mode = createPinMode(host, handlers)
   document.body.append(mode.element)
   mode.start()
   layer = mode.element.querySelector(".pin-layer") as HTMLElement
}

beforeEach(() => {
   vi.useFakeTimers()
})

afterEach(() => {
   vi.useRealTimers()
   vi.restoreAllMocks()
   document.body.innerHTML = ""
})

describe("pin mode", () => {
   it("pins the element under a click", () => {
      setup()
      layer.dispatchEvent(pointer("pointerdown", { x: 50, y: 130 }))
      layer.dispatchEvent(pointer("pointerup", { x: 50, y: 130 }))
      layer.dispatchEvent(pointer("click", { x: 50, y: 130 }))
      expect(handlers.pick).toHaveBeenCalledWith(target, 50, 130)
      expect(handlers.pickArea).not.toHaveBeenCalled()
   })

   it("draws an area with the mouse and hands it over with its containing element", () => {
      setup()
      layer.dispatchEvent(pointer("pointerdown", { x: 30, y: 110 }))
      layer.dispatchEvent(pointer("pointermove", { x: 33, y: 112 }))
      expect(layer.parentElement?.querySelector(".area-draw")?.hasAttribute("hidden")).toBe(true)

      layer.dispatchEvent(pointer("pointermove", { x: 200, y: 250 }))
      const drawn = layer.parentElement?.querySelector(".area-draw") as HTMLElement
      expect(drawn.hidden).toBe(false)
      expect(drawn.style.width).toBe("170px")
      expect(drawn.textContent).toBe("170 × 140")

      layer.dispatchEvent(pointer("pointerup", { x: 200, y: 250 }))
      layer.dispatchEvent(pointer("click", { x: 200, y: 250 }))
      expect(handlers.pickArea).toHaveBeenCalledWith(document.querySelector("section"), {
         x: 30,
         y: 110,
         width: 170,
         height: 140
      })
      expect(handlers.pick).not.toHaveBeenCalled()
      expect(drawn.hidden).toBe(true)
   })

   it("normalises a drag towards the top-left and clamps it to the viewport", () => {
      setup()
      layer.dispatchEvent(pointer("pointerdown", { x: 200, y: 250 }))
      layer.dispatchEvent(pointer("pointermove", { x: -40, y: 110 }))
      layer.dispatchEvent(pointer("pointerup", { x: -40, y: 110 }))
      expect(handlers.pickArea).toHaveBeenCalledWith(expect.anything(), {
         x: 0,
         y: 110,
         width: 200,
         height: 140
      })
   })

   it("drops a slipped click that is too small to be an area", () => {
      setup()
      layer.dispatchEvent(pointer("pointerdown", { x: 30, y: 110 }))
      layer.dispatchEvent(pointer("pointermove", { x: 37, y: 112 }))
      layer.dispatchEvent(pointer("pointerup", { x: 37, y: 112 }))
      layer.dispatchEvent(pointer("click", { x: 37, y: 112 }))
      expect(handlers.pickArea).not.toHaveBeenCalled()
      expect(handlers.pick).not.toHaveBeenCalled()
   })

   it("lets a quick swipe scroll on touch, but draws after holding still", () => {
      setup()
      const touch = { pointerType: "touch" }
      layer.dispatchEvent(pointer("pointerdown", { x: 30, y: 110, ...touch }))
      layer.dispatchEvent(pointer("pointermove", { x: 30, y: 300, ...touch }))
      vi.advanceTimersByTime(500)
      layer.dispatchEvent(pointer("pointercancel", { x: 30, y: 300, ...touch }))
      expect(handlers.pickArea).not.toHaveBeenCalled()

      layer.dispatchEvent(pointer("pointerdown", { x: 30, y: 110, ...touch }))
      vi.advanceTimersByTime(500)
      const move = new Event("touchmove", { cancelable: true })
      layer.dispatchEvent(move)
      expect(move.defaultPrevented).toBe(true)
      layer.dispatchEvent(pointer("pointermove", { x: 200, y: 250, ...touch }))
      layer.dispatchEvent(pointer("pointerup", { x: 200, y: 250, ...touch }))
      expect(handlers.pickArea).toHaveBeenCalledWith(expect.anything(), {
         x: 30,
         y: 110,
         width: 170,
         height: 140
      })
   })

   it("cancels with Escape", () => {
      setup()
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }))
      expect(handlers.cancel).toHaveBeenCalledOnce()
   })
})
