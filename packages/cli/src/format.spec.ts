import { describe, expect, it } from "vitest"
import { authorLabel, firstLine, relativeTime, renderTable, siteSlug, truncate } from "./format"
import { jan } from "./test-harness"

describe("format", () => {
   it("truncates with an ellipsis only when needed", () => {
      expect(truncate("short", 10)).toBe("short")
      expect(truncate("exactly10!", 10)).toBe("exactly10!")
      expect(truncate("a bit too long", 10)).toBe("a bit too…")
   })

   it("takes the first non-empty line", () => {
      expect(firstLine("\n  first  \nsecond")).toBe("first")
      expect(firstLine("")).toBe("")
   })

   it("formats relative times", () => {
      const now = new Date("2026-10-10T12:00:00.000Z")
      expect(relativeTime("2026-10-10T11:59:30.000Z", now)).toBe("just now")
      expect(relativeTime("2026-10-10T11:55:00.000Z", now)).toBe("5m ago")
      expect(relativeTime("2026-10-10T09:00:00.000Z", now)).toBe("3h ago")
      expect(relativeTime("2026-10-01T12:00:00.000Z", now)).toBe("9d ago")
      expect(relativeTime("2026-08-01T12:00:00.000Z", now)).toBe("2026-08-01")
   })

   it("renders aligned tables without trailing spaces", () => {
      expect(
         renderTable(
            ["#", "NAME"],
            [
               ["1", "a"],
               ["12", "longer"]
            ]
         )
      ).toBe("#   NAME\n1   a\n12  longer")
   })

   it("labels users and agents", () => {
      expect(authorLabel(jan)).toBe("Jan")
      expect(authorLabel({ ...jan, name: null })).toBe("jan@studypilot.app")
      expect(
         authorLabel({ kind: "agent", id: "66666666-6666-4666-8666-666666666666", name: "Claude" })
      ).toBe("Claude (agent)")
   })

   it("slugs site keys for file names", () => {
      expect(siteSlug("feat/Login@2.0")).toBe("feat-login-2-0")
      expect(siteSlug("-x-")).toBe("x")
   })
})
