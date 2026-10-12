import { describe, expect, it } from "vitest"
import { buildSquawkPageUrl, isSafeHttpUrl } from "./links"

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
