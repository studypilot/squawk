import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Comment, SquawkDetail, Token, UserAuthor } from "@squawk/shared"
import { vi, type Mock } from "vitest"
import type { Environment } from "./config"
import type { CliContext } from "./context"
import { runCli } from "./program"

export const SERVER = "https://squawk.test"
export const TOKEN = "sqk_testtokentesttokentesttokentest"
export const NOW = new Date("2026-10-10T12:00:00.000Z")

export interface Harness {
   directory: string
   context: CliContext
   fetchMock: Mock<typeof fetch>
   openUrl: Mock<(url: string) => void>
   run(...argv: string[]): Promise<number>
   stdout(): string
   stderr(): string
   cleanup(): Promise<void>
}

/**
 * A CLI context in a fresh temp directory (used as cwd and XDG_CONFIG_HOME) with a stubbed
 * global fetch. By default SQUAWK_SERVER and SQUAWK_TOKEN point at a fake server.
 */
export async function createHarness(
   options: { environment?: Environment; stdin?: string } = {}
): Promise<Harness> {
   const directory = await mkdtemp(join(tmpdir(), "squawk-cli-"))
   const stdout: string[] = []
   const stderr: string[] = []
   const fetchMock = vi.fn<typeof fetch>()
   const openUrl = vi.fn<(url: string) => void>()
   vi.stubGlobal("fetch", fetchMock)

   const context: CliContext = {
      environment: {
         XDG_CONFIG_HOME: directory,
         SQUAWK_SERVER: SERVER,
         SQUAWK_TOKEN: TOKEN,
         ...options.environment
      },
      cwd: directory,
      hostname: "test-host",
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
      readStdin: async () => options.stdin ?? "",
      openUrl,
      now: () => NOW
   }

   return {
      directory,
      context,
      fetchMock,
      openUrl,
      run: (...argv) => runCli(argv, context),
      stdout: () => stdout.join(""),
      stderr: () => stderr.join(""),
      cleanup: async () => {
         vi.unstubAllGlobals()
         await rm(directory, { recursive: true, force: true })
      }
   }
}

export function jsonResponse(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
   })
}

export function errorResponse(status: number, code: string, message: string): Response {
   return jsonResponse({ error: { code, message } }, status)
}

export interface RecordedRequest {
   url: string
   method: string
   headers: Record<string, string>
   body: unknown
}

export function recordedRequest(fetchMock: Mock<typeof fetch>, index: number): RecordedRequest {
   const call = fetchMock.mock.calls[index]
   if (call === undefined) throw new Error(`No fetch call #${index}`)
   const [url, init] = call
   const body = init?.body
   return {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof body === "string" ? JSON.parse(body) : undefined
   }
}

export const jan: UserAuthor = {
   kind: "user",
   id: "11111111-1111-4111-8111-111111111111",
   email: "jan@studypilot.app",
   name: "Jan",
   avatarUrl: null,
   agent: null
}

/** Jan's CLI login token writing on Jan's behalf. */
export const janAgent: UserAuthor = {
   ...jan,
   agent: { tokenId: "77777777-7777-4777-8777-777777777777", name: "CLI test-host" }
}

const squawkId = "22222222-2222-4222-8222-222222222222"

export function commentFixture(overrides: Partial<Comment> = {}): Comment {
   return {
      id: "33333333-3333-4333-8333-333333333333",
      squawkId,
      body: "The save button overlaps the footer.",
      author: jan,
      createdAt: "2026-10-10T10:00:00.000Z",
      ...overrides
   }
}

export function squawkFixture(overrides: Partial<SquawkDetail> = {}): SquawkDetail {
   return {
      id: squawkId,
      siteKey: "feat/login",
      number: 3,
      page: "/settings",
      status: "open",
      anchor: {
         version: 1,
         selectors: {
            testId: "save-button",
            css: "main > button.save",
            text: { exact: "Save" },
            tagName: "button"
         },
         rect: { x: 0.5, y: 0.5 },
         page: { x: 200, y: 700, scrollX: 0, scrollY: 0 },
         elementBox: { x: 180, y: 690, width: 40, height: 20 },
         viewport: { width: 390, height: 844 }
      },
      meta: {
         url: "https://preview.test/settings",
         ref: "abc1234",
         viewport: { width: 390, height: 844 },
         devicePixelRatio: 3
      },
      screenshot: {
         id: "44444444-4444-4444-8444-444444444444",
         width: 1170,
         height: 2532,
         devicePixelRatio: 3,
         source: "extension",
         url: "/api/screenshots/44444444-4444-4444-8444-444444444444"
      },
      body: "The save button overlaps the footer.",
      author: jan,
      commentCount: 1,
      createdAt: "2026-10-10T10:00:00.000Z",
      submittedAt: "2026-10-10T10:00:00.000Z",
      lastActivityAt: "2026-10-10T11:00:00.000Z",
      lastAuthor: jan,
      resolvedAt: null,
      resolvedBy: null,
      comments: [
         commentFixture({
            id: "55555555-5555-4555-8555-555555555555",
            body: "Only on small screens.",
            createdAt: "2026-10-10T11:00:00.000Z"
         })
      ],
      ...overrides
   }
}

export function tokenFixture(overrides: Partial<Token> = {}): Token {
   return {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Claude on feat/login",
      prefix: "sqk_a1b2c3d4",
      kind: "agent",
      siteKey: "feat/login",
      createdBy: jan,
      createdAt: "2026-10-01T12:00:00.000Z",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: "2026-10-10T11:30:00.000Z",
      ...overrides
   }
}
