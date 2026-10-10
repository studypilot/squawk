import { describe, expect, it } from "vitest"
import {
   buildSquawkLink,
   defaultSiteKey,
   derivePageKey,
   extractSquawkLinkId,
   stripSquawkLink,
   stripSquawkLinkFromHref
} from "./page-key"

const ID = "0b6f8e3a-2c4d-4e5f-8a9b-1c2d3e4f5a6b"

describe("extractSquawkLinkId", () => {
   it("finds the id in a plain fragment", () => {
      expect(extractSquawkLinkId(`#squawk=${ID}`)).toBe(ID)
   })

   it("finds the id behind app routing in the hash", () => {
      expect(extractSquawkLinkId(`#notes/view?{"id":4}&squawk=${ID}`)).toBe(ID)
      expect(extractSquawkLinkId(`#/settings?squawk=${ID}&tab=2`)).toBe(ID)
   })

   it("ignores look-alike keys and malformed ids", () => {
      expect(extractSquawkLinkId(`#nosquawk=${ID}`)).toBeNull()
      expect(extractSquawkLinkId("#squawk=12")).toBeNull()
      expect(extractSquawkLinkId("")).toBeNull()
   })
})

describe("stripSquawkLink", () => {
   it.each([
      [`#squawk=${ID}`, ""],
      [`#squawk=${ID}&tab=2`, "#tab=2"],
      [`#notes/view?{"id":4}&squawk=${ID}`, `#notes/view?{"id":4}`],
      [`#/settings?squawk=${ID}`, "#/settings"],
      [`#/settings?squawk=${ID}&tab=2`, "#/settings?tab=2"],
      [`#a&squawk=${ID}&b`, "#a&b"],
      ["#/plain", "#/plain"],
      ["", ""]
   ])("%s -> %s", (hash, expected) => {
      expect(stripSquawkLink(hash)).toBe(expected)
   })
})

describe("buildSquawkLink", () => {
   it("adds a fragment when there is none", () => {
      expect(buildSquawkLink("https://x.test/page?a=1", ID)).toBe(
         `https://x.test/page?a=1#squawk=${ID}`
      )
   })

   it("appends to an existing routing hash without touching it", () => {
      expect(buildSquawkLink(`https://x.test/#notes?{"id":4}`, ID)).toBe(
         `https://x.test/#notes?{"id":4}&squawk=${ID}`
      )
   })

   it("replaces an existing squawk entry", () => {
      const other = "1b6f8e3a-2c4d-4e5f-8a9b-1c2d3e4f5a6b"
      expect(buildSquawkLink(`https://x.test/#r&squawk=${other}`, ID)).toBe(
         `https://x.test/#r&squawk=${ID}`
      )
   })
})

describe("derivePageKey", () => {
   it("combines path, query and hash without the squawk entry", () => {
      expect(
         derivePageKey({ pathname: "/app", search: "?x=1", hash: `#notes?{"id":4}&squawk=${ID}` })
      ).toBe(`/app?x=1#notes?{"id":4}`)
   })

   it("falls back to the root path", () => {
      expect(derivePageKey({ pathname: "", search: "", hash: "" })).toBe("/")
   })
})

describe("site keys and hrefs", () => {
   it("sanitises hostnames into valid site keys", () => {
      expect(defaultSiteKey("preview.example.com")).toBe("preview.example.com")
      expect(defaultSiteKey("[::1]")).toBe("-::1-")
      expect(defaultSiteKey("")).toBe("localhost")
   })

   it("strips the squawk entry from an href", () => {
      expect(stripSquawkLinkFromHref(`https://x.test/a#squawk=${ID}`)).toBe("https://x.test/a")
   })
})
