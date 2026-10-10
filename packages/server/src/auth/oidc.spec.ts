import type * as client from "openid-client"
import { describe, expect, it } from "vitest"
import type { OidcConfig } from "../config"
import { checkClaims, safeReturnPath } from "./oidc"

const oidc: OidcConfig = {
   issuer: "https://accounts.google.com",
   clientId: "id",
   clientSecret: "secret",
   allowedEmailDomains: ["example.com"],
   hostedDomain: null
}

function claims(overrides: Record<string, unknown>): client.IDToken {
   return {
      iss: oidc.issuer,
      sub: "123",
      aud: oidc.clientId,
      iat: 1,
      exp: 2,
      email: "ada@example.com",
      email_verified: true,
      ...overrides
   } as client.IDToken
}

describe("checkClaims", () => {
   it("accepts a verified email from an allowed domain", () => {
      expect(checkClaims(claims({}), oidc)).toBeNull()
   })

   it("requires email_verified to be exactly true", () => {
      for (const email_verified of [false, undefined, "true", 1]) {
         expect(checkClaims(claims({ email_verified }), oidc), String(email_verified)).toBe(
            "Your email address is not verified."
         )
      }
   })

   it("still rejects missing tokens, missing emails and foreign domains", () => {
      expect(checkClaims(undefined, oidc)).toMatch(/no ID token/)
      expect(checkClaims(claims({ email: undefined }), oidc)).toMatch(/no email address/)
      expect(checkClaims(claims({ email: "eve@evil.example" }), oidc)).toMatch(/evil\.example/)
   })

   it("checks the hosted domain when configured", () => {
      const hosted = { ...oidc, hostedDomain: "example.com" }
      expect(checkClaims(claims({ hd: "example.com" }), hosted)).toBeNull()
      expect(checkClaims(claims({}), hosted)).toMatch(/example\.com account/)
   })
})

describe("safeReturnPath", () => {
   it("keeps same-origin paths and falls back to the root otherwise", () => {
      expect(safeReturnPath("/sites/main?status=all")).toBe("/sites/main?status=all")
      for (const value of [undefined, "", "//evil.example", "https://evil.example", "/a\\b"]) {
         expect(safeReturnPath(value)).toBe("/")
      }
   })
})
