import { describe, expect, it } from "vitest"
import { safeReturnPath } from "./auth/oidc"
import { loadConfig } from "./config"

const baseEnvironment = {
   DATABASE_URL: "postgres://squawk@localhost/squawk",
   PUBLIC_URL: "https://squawk.example.com/",
   SESSION_SECRET: "x".repeat(32)
}

describe("loadConfig", () => {
   it("applies defaults and disables OIDC without client credentials", () => {
      const config = loadConfig(baseEnvironment)
      expect(config).toMatchObject({
         publicUrl: "https://squawk.example.com",
         dataDir: "/data",
         port: 3000,
         logLevel: "info",
         oidc: null,
         devUserEmail: null,
         trustedOriginPatterns: []
      })
   })

   it("reads trusted origin patterns and refuses malformed ones", () => {
      const config = loadConfig({
         ...baseEnvironment,
         SQUAWK_TRUSTED_ORIGINS: " https://*.Preview.example.com, http://localhost:* ,"
      })
      expect(config.trustedOriginPatterns).toEqual([
         "https://*.preview.example.com",
         "http://localhost:*"
      ])
      for (const value of ["*.example.com", "https://example.com/path", "ftp://example.com"]) {
         expect(() => loadConfig({ ...baseEnvironment, SQUAWK_TRUSTED_ORIGINS: value })).toThrow(
            /SQUAWK_TRUSTED_ORIGINS/
         )
      }
   })

   it("reads the OIDC settings", () => {
      const config = loadConfig({
         ...baseEnvironment,
         OIDC_CLIENT_ID: "client",
         OIDC_CLIENT_SECRET: "secret",
         OIDC_ALLOWED_EMAIL_DOMAINS: "Example.com, example.org",
         OIDC_HOSTED_DOMAIN: "example.com"
      })
      expect(config.oidc).toEqual({
         issuer: "https://accounts.google.com",
         clientId: "client",
         clientSecret: "secret",
         allowedEmailDomains: ["example.com", "example.org"],
         hostedDomain: "example.com"
      })
   })

   it("refuses incomplete OIDC settings", () => {
      expect(() => loadConfig({ ...baseEnvironment, OIDC_CLIENT_ID: "client" })).toThrow(
         /OIDC_CLIENT_SECRET/
      )
      expect(() =>
         loadConfig({ ...baseEnvironment, OIDC_CLIENT_ID: "client", OIDC_CLIENT_SECRET: "secret" })
      ).toThrow(/OIDC_ALLOWED_EMAIL_DOMAINS/)
   })

   it("refuses short session secrets", () => {
      expect(() => loadConfig({ ...baseEnvironment, SESSION_SECRET: "short" })).toThrow(
         /SESSION_SECRET/
      )
   })

   it("refuses the development user in production", () => {
      const environment = { ...baseEnvironment, SQUAWK_DEV_USER: "dev@example.com" }
      expect(loadConfig(environment).devUserEmail).toBe("dev@example.com")
      expect(() => loadConfig({ ...environment, NODE_ENV: "production" })).toThrow(
         /SQUAWK_DEV_USER/
      )
   })
})

describe("safeReturnPath", () => {
   it("only allows same-origin paths", () => {
      expect(safeReturnPath("/device?code=ABCD-EFGH")).toBe("/device?code=ABCD-EFGH")
      expect(safeReturnPath("/connect?origin=https%3A%2F%2Fpreview.example.com")).toBe(
         "/connect?origin=https%3A%2F%2Fpreview.example.com"
      )
      expect(safeReturnPath("https://evil.example.com")).toBe("/")
      expect(safeReturnPath("//evil.example.com")).toBe("/")
      expect(safeReturnPath("/\\evil.example.com")).toBe("/")
      expect(safeReturnPath(undefined)).toBe("/")
   })
})
