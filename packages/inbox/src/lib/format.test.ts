import { describe, expect, it } from "vitest"
import { firstLine, formatRelativeTime, formatUserCode, isCompleteUserCode } from "./format"

describe("formatUserCode", () => {
   it("upper-cases and inserts the dash after four characters", () => {
      expect(formatUserCode("wxyz1234")).toBe("WXYZ-1234")
      expect(formatUserCode("wxyz1")).toBe("WXYZ-1")
   })

   it("does not add a dash for four characters or fewer", () => {
      expect(formatUserCode("wx")).toBe("WX")
      expect(formatUserCode("wxyz")).toBe("WXYZ")
   })

   it("removes a dangling dash when the user deletes past it", () => {
      expect(formatUserCode("WXYZ-")).toBe("WXYZ")
   })

   it("drops other characters and caps the length", () => {
      expect(formatUserCode(" wx yz - 12 34 99")).toBe("WXYZ-1234")
   })

   it("recognises complete codes", () => {
      expect(isCompleteUserCode("WXYZ-1234")).toBe(true)
      expect(isCompleteUserCode("WXYZ-123")).toBe(false)
   })
})

describe("formatRelativeTime", () => {
   const now = new Date("2026-10-10T12:00:00.000Z")

   it("formats past and future times", () => {
      expect(formatRelativeTime("2026-10-10T11:59:50.000Z", now)).toBe("just now")
      expect(formatRelativeTime("2026-10-10T11:55:00.000Z", now)).toBe("5 minutes ago")
      expect(formatRelativeTime("2026-10-07T12:00:00.000Z", now)).toBe("3 days ago")
      expect(formatRelativeTime("2026-10-12T12:00:00.000Z", now)).toBe("in 2 days")
   })
})

describe("firstLine", () => {
   it("returns the first non-empty line", () => {
      expect(firstLine("\n  Button is cut off  \nmore")).toBe("Button is cut off")
   })
})
