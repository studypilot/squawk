import { afterEach, describe, expect, it } from "vitest"
import { layoutViewport } from "./viewport"

function defineClientSize(width: number | undefined, height: number | undefined): void {
   Object.defineProperty(document.documentElement, "clientWidth", {
      value: width,
      configurable: true
   })
   Object.defineProperty(document.documentElement, "clientHeight", {
      value: height,
      configurable: true
   })
}

describe("layoutViewport", () => {
   afterEach(() => {
      defineClientSize(undefined, undefined)
   })

   it("prefers the document's client size over the window's inner size", () => {
      defineClientSize(390, 844)
      Object.assign(window, { innerWidth: 351, innerHeight: 338 })

      expect(layoutViewport()).toEqual({ width: 390, height: 844 })
   })

   it("falls back to the window size when the client size is unavailable", () => {
      defineClientSize(0, 0)
      Object.assign(window, { innerWidth: 1200, innerHeight: 800 })

      expect(layoutViewport()).toEqual({ width: 1200, height: 800 })
   })
})
