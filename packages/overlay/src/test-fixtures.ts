import type { Squawk } from "@squawk/shared"

export const SQUAWK_ID = "0b6f8e3a-2c4d-4e5f-8a9b-1c2d3e4f5a6b"
export const USER_ID = "4f1d2c3b-5a6e-4f7a-9b8c-0d1e2f3a4b5c"

export function squawkFixture(overrides: Partial<Squawk> = {}): Squawk {
   return {
      id: SQUAWK_ID,
      siteKey: "feature/foo",
      number: 12,
      page: "/",
      status: "open",
      anchor: null,
      meta: {},
      screenshot: null,
      body: "Button is misaligned",
      author: { kind: "user", id: USER_ID, email: "a@example.com", name: "Ada", avatarUrl: null },
      commentCount: 1,
      createdAt: "2026-10-10T12:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      ...overrides
   }
}
