import type { Anchor, Screenshot } from "@squawk/shared"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { computePinPosition, ScreenshotWithPin } from "./screenshot-with-pin"

const anchor: Anchor = {
   version: 1,
   selectors: { tagName: "button" },
   rect: { x: 0.5, y: 0.5 },
   page: { x: 200, y: 250, scrollX: 0, scrollY: 0 },
   elementBox: { x: 100, y: 200, width: 200, height: 100 },
   viewport: { width: 1000, height: 800 }
}

const screenshot: Screenshot = {
   id: "2c5e0f3a-7d4b-4e8a-b1c2-3d4e5f6a7b8c",
   width: 2000,
   height: 1600,
   devicePixelRatio: 2,
   source: "dom",
   url: "/api/screenshots/2c5e0f3a-7d4b-4e8a-b1c2-3d4e5f6a7b8c"
}

describe("computePinPosition", () => {
   it("places the click point proportionally on a scaled screenshot", () => {
      expect(computePinPosition(anchor, screenshot)).toEqual({ leftPercent: 20, topPercent: 31.25 })
   })

   it("keeps the width scale when the screenshot is cropped vertically", () => {
      const position = computePinPosition(anchor, { width: 2000, height: 1500 })
      expect(position?.leftPercent).toBe(20)
      expect(position?.topPercent).toBeCloseTo(33.333, 2)
   })

   it("returns null for points outside the screenshot", () => {
      const offscreen = { ...anchor, elementBox: { x: 100, y: 900, width: 200, height: 100 } }
      expect(computePinPosition(offscreen, screenshot)).toBeNull()
   })
})

describe("ScreenshotWithPin", () => {
   it("draws the marker and the approximate note for DOM screenshots", () => {
      render(<ScreenshotWithPin screenshot={screenshot} anchor={anchor} label="site #1" />)
      const pin = screen.getByTestId("pin")
      expect(pin.style.left).toBe("20%")
      expect(pin.style.top).toBe("31.25%")
      expect(screen.getByText(/Approximate screenshot/)).toBeTruthy()
      expect(screen.getByRole("img").getAttribute("src")).toBe(`/api/screenshots/${screenshot.id}`)
   })

   it("skips the marker without an anchor", () => {
      render(
         <ScreenshotWithPin
            screenshot={{ ...screenshot, source: "extension" }}
            anchor={null}
            label="site #1"
         />
      )
      expect(screen.queryByTestId("pin")).toBeNull()
      expect(screen.queryByText(/Approximate screenshot/)).toBeNull()
   })
})
