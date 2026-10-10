import { describe, expect, it } from "vitest"
import { resolveRef } from "./refs"

describe("resolveRef", () => {
   it("passes a uuid through, lower-cased", () => {
      expect(resolveRef("2222AAAA-2222-4222-8222-222222222222")).toBe(
         "2222aaaa-2222-4222-8222-222222222222"
      )
   })

   it("encodes <site>#<n> as one path segment", () => {
      expect(resolveRef("my-site#12")).toBe("my-site%2312")
      expect(resolveRef("feat/login#3")).toBe("feat%2Flogin%233")
   })

   it("splits at the last # and drops leading zeros", () => {
      expect(resolveRef("site#007")).toBe("site%237")
   })

   it("combines #<n> and <n> with --site", () => {
      expect(resolveRef("#4", "feat/login")).toBe("feat%2Flogin%234")
      expect(resolveRef("4", "feat/login")).toBe("feat%2Flogin%234")
   })

   it("prefers the site in the reference over --site", () => {
      expect(resolveRef("other#1", "feat/login")).toBe("other%231")
   })

   it("requires --site for bare numbers", () => {
      expect(() => resolveRef("#4")).toThrow(/needs --site/)
   })

   it("rejects malformed references", () => {
      expect(() => resolveRef("site#")).toThrow(/Invalid squawk number/)
      expect(() => resolveRef("site#0")).toThrow(/Invalid squawk number/)
      expect(() => resolveRef("site#abc")).toThrow(/Invalid squawk number/)
      expect(() => resolveRef("bad site#1")).toThrow(/Invalid site key/)
      expect(() => resolveRef("nonsense")).toThrow(/Invalid squawk reference/)
      expect(() => resolveRef("#4", "bad site")).toThrow(/Invalid site key/)
   })
})
