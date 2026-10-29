import { describe, expect, it } from "vitest"
import { NOW, squawkFixture } from "../test-harness"
import { renderDetail } from "./show"

describe("renderDetail", () => {
   it("prints the area of an area squawk in viewport pixels", () => {
      const detail = squawkFixture()
      if (detail.anchor === null) throw new Error("fixture has no anchor")
      const withArea = {
         ...detail,
         anchor: { ...detail.anchor, area: { x: 40.4, y: 200, width: 320, height: 139.6 } }
      }
      const lines = renderDetail(withArea, NOW).split("\n")
      expect(lines).toContain("Area:      320×140 at (40, 200)")
      expect(renderDetail(detail, NOW)).not.toContain("Area:")
   })
})
