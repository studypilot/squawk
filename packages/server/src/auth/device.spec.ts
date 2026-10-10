import {
   deviceInfoResponseSchema,
   devicePollResponseSchema,
   deviceStartResponseSchema,
   meResponseSchema,
   type DevicePollResponse,
   type DeviceStartResponse
} from "@squawk/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deviceCodes, tokens } from "../db/schema"
import { createTestContext, type TestContext } from "../testing/test-context"
import { PENDING_DEVICE_CODES_MAX } from "./device"
import { sha256Hex } from "./secrets"

let context: TestContext
let cookie: string

beforeAll(async () => {
   context = await createTestContext()
   cookie = (await context.signIn("grace@example.com")).cookie
})

afterAll(() => context.close())

let nextAddress = 0

/** Starts from a fresh client address unless given one, so tests do not share the limiter. */
async function start(
   label: string,
   options: { kind?: string; address?: string } = {}
): Promise<DeviceStartResponse> {
   const response = await startRequest(label, options)
   expect(response.status).toBe(200)
   return deviceStartResponseSchema.parse(await response.json())
}

function startRequest(
   label: string,
   { kind = "cli", address = `10.0.0.${(nextAddress += 1)}` }: { kind?: string; address?: string }
): Promise<Response> {
   return context.request("POST", "/api/auth/device", {
      headers: { "X-Forwarded-For": `${address}, 192.0.2.1` },
      json: { kind, label }
   })
}

async function poll(deviceCode: string): Promise<{ status: number; body: unknown }> {
   const response = await context.request("POST", "/api/auth/device/token", {
      json: { deviceCode }
   })
   return { status: response.status, body: await response.json() }
}

async function pollParsed(deviceCode: string): Promise<DevicePollResponse> {
   const { status, body } = await poll(deviceCode)
   expect(status).toBe(200)
   return devicePollResponseSchema.parse(body)
}

/** Lets the next poll through without waiting for the real interval. */
async function forgetLastPoll(deviceCode: string): Promise<void> {
   await context.database
      .update(deviceCodes)
      .set({ lastPolledAt: null })
      .where(eq(deviceCodes.deviceCodeHash, sha256Hex(deviceCode)))
}

describe("device-code login", () => {
   it("issues a login token after approval, exactly once", async () => {
      const started = await start("laptop.local")
      expect(started.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
      expect(started.deviceCode).toHaveLength(32)
      expect(started.verificationUrl).toBe(`http://squawk.test/device?code=${started.userCode}`)
      expect(started).toMatchObject({ expiresIn: 600, interval: 3 })

      expect(await pollParsed(started.deviceCode)).toEqual({ status: "pending" })

      const lowerCaseCode = started.userCode.replace("-", "").toLowerCase()
      const info = await context.request("GET", `/api/auth/device/info?userCode=${lowerCaseCode}`, {
         credentials: { cookie }
      })
      expect(deviceInfoResponseSchema.parse(await info.json())).toMatchObject({
         userCode: started.userCode,
         kind: "cli",
         label: "laptop.local"
      })

      const approve = await context.request("POST", "/api/auth/device/approve", {
         credentials: { cookie },
         json: { userCode: started.userCode }
      })
      expect(approve.status).toBe(204)

      await forgetLastPoll(started.deviceCode)
      const approved = await pollParsed(started.deviceCode)
      if (approved.status !== "approved") throw new Error(`unexpected ${approved.status}`)
      expect(approved.token).toMatch(/^sqk_[A-Za-z0-9]{32}$/)
      expect(approved.principal.email).toBe("grace@example.com")

      const [stored] = await context.database
         .select()
         .from(tokens)
         .where(eq(tokens.hash, sha256Hex(approved.token)))
      expect(stored).toMatchObject({ name: "CLI laptop.local", kind: "login" })
      const lifetimeDays = (stored!.expiresAt!.getTime() - Date.now()) / 86_400_000
      expect(Math.round(lifetimeDays)).toBe(30)

      const me = await context.request("GET", "/api/me", {
         credentials: { bearer: approved.token }
      })
      expect(meResponseSchema.parse(await me.json())).toMatchObject({
         principal: { kind: "user", email: "grace@example.com" },
         token: { kind: "login", name: "CLI laptop.local" }
      })

      await forgetLastPoll(started.deviceCode)
      expect(await pollParsed(started.deviceCode)).toEqual({ status: "expired" })
   })

   it("reports a denial once, then forgets the code", async () => {
      const started = await start("https://preview.example.com", { kind: "overlay" })
      const deny = await context.request("POST", "/api/auth/device/deny", {
         credentials: { cookie },
         json: { userCode: started.userCode }
      })
      expect(deny.status).toBe(204)

      expect(await pollParsed(started.deviceCode)).toEqual({ status: "denied" })
      expect(await pollParsed(started.deviceCode)).toEqual({ status: "expired" })
   })

   it("answers expired for unknown and expired codes alike", async () => {
      expect(await pollParsed("unknown-device-code")).toEqual({ status: "expired" })

      const started = await start("expiring.local")
      await context.database
         .update(deviceCodes)
         .set({ expiresAt: new Date(Date.now() - 1000) })
         .where(eq(deviceCodes.userCode, started.userCode))
      expect(await pollParsed(started.deviceCode)).toEqual({ status: "expired" })

      const approve = await context.request("POST", "/api/auth/device/approve", {
         credentials: { cookie },
         json: { userCode: started.userCode }
      })
      expect(approve.status).toBe(404)
   })

   it("rejects polling faster than the interval", async () => {
      const started = await start("impatient.local")
      expect((await poll(started.deviceCode)).status).toBe(200)
      const tooFast = await poll(started.deviceCode)
      expect(tooFast.status).toBe(429)
      expect(tooFast.body).toMatchObject({ error: { code: "rate_limited" } })
   })

   it("limits starts to five per client address and minute, whatever the label", async () => {
      const address = "198.51.100.7"
      for (let attempt = 0; attempt < 5; attempt += 1) {
         await start(`busy-${attempt}.local`, { address })
      }
      const sixth = await startRequest("another.local", { address })
      expect(sixth.status).toBe(429)
      await start("busy-0.local", { address: "198.51.100.8" })

      const sameSocket = () =>
         context.request("POST", "/api/auth/device", {
            json: { kind: "cli", label: "no-proxy.local" }
         })
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await sameSocket()).status).toBe(200)
      expect((await sameSocket()).status).toBe(429)
   })

   it("caps the number of pending codes across all callers", async () => {
      const expiresAt = new Date(Date.now() + 600_000)
      const filler = Array.from({ length: PENDING_DEVICE_CODES_MAX }, (_, index) => ({
         deviceCodeHash: sha256Hex(`filler-${index}`),
         userCode: `FILL-${index.toString(36).toUpperCase().padStart(4, "0")}`,
         kind: "cli" as const,
         label: "filler",
         expiresAt
      }))
      await context.database.insert(deviceCodes).values(filler)
      try {
         const overCap = await startRequest("late.local", {})
         expect(overCap.status).toBe(429)
         expect(await overCap.json()).toMatchObject({ error: { code: "rate_limited" } })
      } finally {
         await context.database.delete(deviceCodes).where(eq(deviceCodes.label, "filler"))
      }
      await start("after-cleanup.local")
   })

   it("requires a browser session to look up or approve codes", async () => {
      const started = await start("guarded.local")
      const anonymous = await context.request(
         "GET",
         `/api/auth/device/info?userCode=${started.userCode}`
      )
      expect(anonymous.status).toBe(401)

      const { user } = await context.signIn("grace@example.com")
      const { secret } = await context.createToken({ kind: "login", createdBy: user })
      const viaToken = await context.request("POST", "/api/auth/device/approve", {
         credentials: { bearer: secret },
         json: { userCode: started.userCode }
      })
      expect(viaToken.status).toBe(403)
   })
})
