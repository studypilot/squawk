import { describe, expect, it } from "vitest"
import { elementLabel, labelForElement } from "./element-label"

describe("elementLabel", () => {
   it("prefers the test id", () => {
      expect(elementLabel({ testId: "save", tagName: "button", text: "Save" })).toBe(
         "button [save]"
      )
   })

   it("names the element by tag and the start of its text", () => {
      expect(elementLabel({ tagName: "button", text: "Save changes" })).toBe(
         'button "Save changes"'
      )
      expect(elementLabel({ tagName: "p", text: "a".repeat(40) })).toBe(`p "${"a".repeat(31)}…"`)
      expect(elementLabel({ tagName: "div", text: "  " })).toBe("div")
   })

   it("skips the text of large containers", () => {
      const list = document.createElement("ul")
      for (let index = 0; index < 8; index++) {
         list.append(Object.assign(document.createElement("li"), { textContent: `Item ${index}` }))
      }
      document.body.append(list)
      expect(labelForElement(list)).toBe("ul")
      list.remove()
   })
})
