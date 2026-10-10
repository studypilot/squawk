import { describe, expect, it } from "vitest"
import { buildSquawkPageUrl, isSafeHttpUrl, splitParagraphs, splitTextIntoLinks } from "./links"

const id = "0b7a7c55-3d5e-4c6a-9f39-6a1d5b1f2e10"

describe("buildSquawkPageUrl", () => {
   it("adds a fragment when the URL has none", () => {
      expect(buildSquawkPageUrl("https://preview.example.com/settings?tab=1", id)).toBe(
         `https://preview.example.com/settings?tab=1#squawk=${id}`
      )
   })

   it("appends to an existing fragment", () => {
      expect(buildSquawkPageUrl("https://preview.example.com/#/notes/12", id)).toBe(
         `https://preview.example.com/#/notes/12&squawk=${id}`
      )
   })

   it("fills an empty fragment without a leading ampersand", () => {
      expect(buildSquawkPageUrl("https://preview.example.com/#", id)).toBe(
         `https://preview.example.com/#squawk=${id}`
      )
   })

   it("replaces a stale squawk entry", () => {
      expect(buildSquawkPageUrl("https://preview.example.com/#/a&squawk=old", id)).toBe(
         `https://preview.example.com/#/a&squawk=${id}`
      )
   })
})

describe("isSafeHttpUrl", () => {
   it("accepts http and https only", () => {
      expect(isSafeHttpUrl("https://example.com")).toBe(true)
      expect(isSafeHttpUrl("http://localhost:5173/x")).toBe(true)
      expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false)
      expect(isSafeHttpUrl("not a url")).toBe(false)
   })
})

describe("splitTextIntoLinks", () => {
   it("links URLs and keeps trailing punctuation outside", () => {
      expect(splitTextIntoLinks("See https://example.com/a?b=1. Thanks")).toEqual([
         { kind: "text", text: "See " },
         { kind: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
         { kind: "text", text: ". Thanks" }
      ])
   })

   it("leaves text without URLs alone", () => {
      expect(splitTextIntoLinks("<b>no html</b>")).toEqual([
         { kind: "text", text: "<b>no html</b>" }
      ])
   })
})

describe("splitParagraphs", () => {
   it("splits on blank lines and keeps single line breaks", () => {
      expect(splitParagraphs("one\ntwo\n\n\nthree\n")).toEqual(["one\ntwo", "three"])
   })
})
