import { anchorSchema } from "@squawk/shared"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { absoluteXPath, captureAnchor } from "./capture"
import { resolveAnchor } from "./resolve"

interface Box {
   x: number
   y: number
   width: number
   height: number
}

const DEFAULT_BOX: Box = { x: 0, y: 0, width: 100, height: 20 }
let boxes = new WeakMap<Element, Box>()

function setBox(element: Element | null, box: Box): void {
   if (!element) throw new Error("element missing")
   boxes.set(element, box)
}

function query(selector: string): Element {
   const element = document.querySelector(selector)
   if (!element) throw new Error(`${selector} not found`)
   return element
}

beforeAll(() => {
   // jsdom lacks CSS.escape, which @medv/finder relies on.
   const escape = (value: string): string =>
      value.replace(/[^\w-]/g, character => `\\${character}`).replace(/^(\d)/, "\\3$1 ")
   vi.stubGlobal("CSS", { escape })
})

beforeEach(() => {
   boxes = new WeakMap()
   vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
   ) {
      const { x, y, width, height } = boxes.get(this) ?? DEFAULT_BOX
      return {
         x,
         y,
         width,
         height,
         left: x,
         top: y,
         right: x + width,
         bottom: y + height,
         toJSON: () => ({})
      } as DOMRect
   })
   document.body.innerHTML = `
      <main>
         <h1>Notes</h1>
         <ul class="list">
            <li data-testid="note-1"><span class="title">Homework</span> due Monday</li>
            <li data-testid="note-2"><span class="title">Groceries</span> due Friday</li>
         </ul>
         <section>
            <p>Intro text before the quote.</p>
            <p class="lead">The quick brown fox</p>
            <p>Outro text after the quote.</p>
         </section>
         <div data-testid="duplicate">A</div>
         <div data-testid="duplicate">B</div>
         <canvas id="sketch" width="300" height="150"></canvas>
      </main>`
})

afterEach(() => {
   vi.restoreAllMocks()
})

describe("captureAnchor", () => {
   it("records selectors, text quote and positions", () => {
      const lead = query(".lead")
      setBox(lead, { x: 100, y: 200, width: 400, height: 40 })
      vi.spyOn(window, "scrollY", "get").mockReturnValue(500)

      const anchor = captureAnchor(lead, 200, 230)

      expect(anchorSchema.parse(anchor)).toEqual(anchor)
      expect(anchor.selectors.testId).toBeUndefined()
      expect(anchor.selectors.tagName).toBe("p")
      expect(anchor.selectors.css).toBeTruthy()
      expect(document.querySelector(anchor.selectors.css ?? "")).toBe(lead)
      expect(anchor.selectors.xpath).toBe("/html/body/main/section/p[2]")
      expect(anchor.selectors.text?.exact).toBe("The quick brown fox")
      expect(anchor.selectors.text?.prefix).toBe("Intro text before the quote. ")
      expect(anchor.selectors.text?.suffix).toBe(" Outro text after the quote.")
      expect(anchor.rect).toEqual({ x: 0.25, y: 0.75 })
      expect(anchor.page).toEqual({ x: 200, y: 730, scrollX: 0, scrollY: 500 })
      expect(anchor.elementBox).toEqual({ x: 100, y: 200, width: 400, height: 40 })
      expect(anchor.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight })
   })

   it("anchors on the nearest ancestor with a unique test id", () => {
      const item = query('[data-testid="note-2"]')
      setBox(item, { x: 0, y: 100, width: 200, height: 50 })

      const anchor = captureAnchor(query('[data-testid="note-2"] .title'), 50, 110)

      expect(anchor.selectors.testId).toBe("note-2")
      expect(anchor.selectors.tagName).toBe("li")
      expect(anchor.rect).toEqual({ x: 0.25, y: 0.2 })
   })

   it("ignores test ids that are not unique", () => {
      const anchor = captureAnchor(query('[data-testid="duplicate"]'), 10, 10)
      expect(anchor.selectors.testId).toBeUndefined()
      expect(anchor.selectors.tagName).toBe("div")
   })

   it("clamps the click point into the element box", () => {
      setBox(query(".lead"), { x: 100, y: 100, width: 100, height: 100 })
      const anchor = captureAnchor(query(".lead"), 400, 50)
      expect(anchor.rect).toEqual({ x: 1, y: 0 })
   })

   it("anchors a canvas as itself", () => {
      const canvas = query("canvas")
      setBox(canvas, { x: 0, y: 0, width: 300, height: 150 })
      const anchor = captureAnchor(canvas, 150, 75)
      expect(anchor.selectors.testId).toBe("sketch")
      expect(anchor.selectors.tagName).toBe("canvas")
      expect(anchor.selectors.text).toBeUndefined()
      expect(resolveAnchor(anchor)?.element).toBe(canvas)
   })
})

describe("absoluteXPath", () => {
   it("only numbers steps whose siblings share the tag", () => {
      expect(absoluteXPath(query('[data-testid="note-2"]'))).toBe("/html/body/main/ul/li[2]")
      expect(absoluteXPath(query("h1"))).toBe("/html/body/main/h1")
   })
})

describe("resolveAnchor", () => {
   it("finds the captured element again", () => {
      const lead = query(".lead")
      const anchor = captureAnchor(lead, 10, 10)
      expect(resolveAnchor(anchor)).toEqual({ element: lead, confidence: "exact" })
   })

   it("follows the test id after a re-render moves the element", () => {
      const anchor = captureAnchor(query('[data-testid="note-2"]'), 10, 10)
      query(".list").innerHTML = `
         <li data-testid="note-3">Laundry</li>
         <li data-testid="note-2"><span class="title">Groceries</span> due Friday</li>
         <li data-testid="note-1"><span class="title">Homework</span> due Monday</li>`
      const rerendered = query('[data-testid="note-2"]')
      setBox(rerendered, { x: 0, y: 300, width: 200, height: 40 })

      expect(resolveAnchor(anchor)).toEqual({ element: rerendered, confidence: "exact" })
   })

   it("falls back to the text quote when the structure changed", () => {
      const anchor = captureAnchor(query(".lead"), 10, 10)
      query("section").innerHTML = `
         <p>A new first paragraph</p>
         <p>Intro text before the quote.</p>
         <p>The quick brown fox</p>`

      const resolved = resolveAnchor(anchor)

      expect(resolved?.confidence).toBe("fuzzy")
      expect(resolved?.element.textContent).toBe("The quick brown fox")
   })

   it("keeps a structural match with fuzzy confidence when only the text changed", () => {
      const lead = query(".lead")
      const anchor = captureAnchor(lead, 10, 10)
      lead.textContent = "The quick brown fox jumps"

      expect(resolveAnchor(anchor)).toEqual({ element: lead, confidence: "fuzzy" })
   })

   it("prefers the smallest element containing the quote", () => {
      const anchor = captureAnchor(query(".lead"), 10, 10)
      query("section").outerHTML = `
         <div><p>Wrapper <span>around</span></p><p>The quick brown fox</p></div>`

      const resolved = resolveAnchor({
         ...anchor,
         selectors: { ...anchor.selectors, css: undefined, xpath: undefined }
      })

      expect(resolved?.element.textContent).toBe("The quick brown fox")
   })

   it("rejects matches with another tag name or an empty box", () => {
      const lead = query(".lead")
      const anchor = captureAnchor(lead, 10, 10)
      setBox(lead, { x: 0, y: 0, width: 0, height: 0 })
      expect(resolveAnchor(anchor)).toBeNull()

      const wrongTag = { ...anchor, selectors: { ...anchor.selectors, tagName: "span" } }
      setBox(lead, DEFAULT_BOX)
      expect(resolveAnchor(wrongTag)).toBeNull()
   })

   it("returns null when nothing matches", () => {
      const anchor = captureAnchor(query(".lead"), 10, 10)
      query("section").remove()
      expect(resolveAnchor(anchor)).toBeNull()
   })
})
