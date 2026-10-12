import type { Squawk, UserAuthor } from "@squawk/shared"

export const SQUAWK_ID = "0b6f8e3a-2c4d-4e5f-8a9b-1c2d3e4f5a6b"
export const DRAFT_ID = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
export const USER_ID = "4f1d2c3b-5a6e-4f7a-9b8c-0d1e2f3a4b5c"
export const TOKEN_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"

export const ADA: UserAuthor = {
   kind: "user",
   id: USER_ID,
   email: "a@example.com",
   name: "Ada Lovelace",
   avatarUrl: null,
   agent: null
}

/** Ada's CLI token writing on her behalf. */
export const ADAS_AGENT: UserAuthor = {
   ...ADA,
   agent: { tokenId: TOKEN_ID, name: "CLI MiniMo.local" }
}

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
      author: ADA,
      commentCount: 1,
      createdAt: "2026-10-10T12:00:00.000Z",
      submittedAt: "2026-10-10T12:00:00.000Z",
      lastActivityAt: "2026-10-10T12:00:00.000Z",
      lastAuthor: ADA,
      unread: false,
      working: null,
      resolvedAt: null,
      resolvedBy: null,
      ...overrides
   }
}

export function draftFixture(overrides: Partial<Squawk> = {}): Squawk {
   return squawkFixture({
      id: DRAFT_ID,
      number: 13,
      status: "draft",
      body: "Spacing feels off",
      commentCount: 0,
      submittedAt: null,
      ...overrides
   })
}
