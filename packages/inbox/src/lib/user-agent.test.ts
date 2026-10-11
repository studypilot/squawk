import { describe, expect, it } from "vitest"
import { describeUserAgent } from "./user-agent"

describe("describeUserAgent", () => {
   it("names mobile Safari", () => {
      expect(
         describeUserAgent(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
         )
      ).toBe("Safari 26 · iOS")
   })

   it("prefers the specific browser over the Chrome and Safari tokens it also carries", () => {
      expect(
         describeUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
         )
      ).toBe("Edge 131 · Windows")
      expect(
         describeUserAgent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
         )
      ).toBe("Chrome 131 · macOS")
   })

   it("returns null for unknown strings", () => {
      expect(describeUserAgent("curl/8.4.0")).toBeNull()
   })
})
