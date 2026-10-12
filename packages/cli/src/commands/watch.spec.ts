import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Author, MeResponse, SquawkDetail } from "@squawk/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
   createHarness,
   errorResponse,
   type Harness,
   jan,
   janAgent,
   jsonResponse,
   SERVER,
   squawkFixture
} from "../test-harness"
import { needsAttention } from "./watch"

const runFile = promisify(execFile)

const reviewer: Author = { ...jan, id: "88888888-8888-4888-8888-888888888888", name: "Rita" }
const me: MeResponse = {
   principal: jan,
   token: {
      id: "77777777-7777-4777-8777-777777777777",
      name: "CLI test-host",
      kind: "login",
      siteKey: null
   }
}
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function squawk(number: number, lastAuthor: Author, overrides: Partial<SquawkDetail> = {}) {
   const id = `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`
   return squawkFixture({
      id,
      number,
      lastAuthor,
      screenshot: {
         ...squawkFixture().screenshot!,
         url: `/api/screenshots/${id}`
      },
      ...overrides
   })
}

/**
 * Answers like the server: `/api/me`, the open list (one response per poll, the last one
 * repeats), details by id and screenshots.
 */
function serve(harness: Harness, polls: (SquawkDetail[] | Error)[]): void {
   let poll = 0
   harness.fetchMock.mockImplementation(async input => {
      const url = new URL(String(input))
      if (url.pathname === "/api/me") return jsonResponse(me)
      if (url.pathname === "/api/squawks") {
         const response = polls[Math.min(poll, polls.length - 1)]!
         poll += 1
         if (response instanceof Error) throw response
         return jsonResponse({ items: response, nextCursor: null })
      }
      const all = polls.flatMap(response => (response instanceof Error ? [] : response))
      const detail = all.find(item => url.pathname === `/api/squawks/${item.id}`)
      if (detail) return jsonResponse(detail)
      if (url.pathname.startsWith("/api/screenshots/")) return new Response(png)
      return errorResponse(404, "not_found", `No route for ${url.pathname}`)
   })
}

/** Advances fake time until the command finishes, yielding to real file I/O in between. */
async function finish(promise: Promise<number>): Promise<number> {
   let settled = false
   void promise.finally(() => {
      settled = true
   })
   for (let step = 0; step < 500 && !settled; step++) {
      await vi.advanceTimersByTimeAsync(1000)
      await new Promise(resolve => setImmediate(resolve))
   }
   return promise
}

describe("squawk watch", () => {
   let harness: Harness

   beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      harness = await createHarness()
   })

   afterEach(async () => {
      vi.useRealTimers()
      await harness.cleanup()
   })

   it("prints every squawk that needs attention with saved screenshots as one JSON", async () => {
      serve(harness, [[squawk(5, reviewer), squawk(4, janAgent), squawk(3, jan)]])
      const out = join(harness.directory, "shots")

      const exitCode = await finish(
         harness.run("watch", "--site", "feat/login", "--json", "--out", out)
      )

      expect(exitCode).toBe(0)
      const result = JSON.parse(harness.stdout())
      expect(result.site).toBe("feat/login")
      expect(result.me).toEqual(me)
      expect(typeof result.checkedAt).toBe("string")
      expect(result.items.map((item: SquawkDetail) => item.number)).toEqual([3, 5])
      expect(result.items[0].comments).toHaveLength(1)
      expect(result.items[0].screenshotPath).toBe(join(out, "feat-login-3.png"))
      expect(new Uint8Array(await readFile(join(out, "feat-login-5.png")))).toEqual(png)

      const listUrl = String(harness.fetchMock.mock.calls[1]?.[0])
      expect(listUrl).toBe(`${SERVER}/api/squawks?site=feat%2Flogin&status=open&limit=200`)
      expect(harness.stderr()).toContain("Watching feat/login")
   })

   it("keeps polling quietly until a human writes", async () => {
      serve(harness, [[squawk(3, janAgent)], [squawk(3, janAgent)], [squawk(3, reviewer)]])

      const exitCode = await finish(
         harness.run("watch", "--site", "feat/login", "--json", "--interval", "5")
      )

      expect(exitCode).toBe(0)
      expect(JSON.parse(harness.stdout()).items).toHaveLength(1)
      const listCalls = harness.fetchMock.mock.calls.filter(([url]) =>
         String(url).includes("/api/squawks?")
      )
      expect(listCalls).toHaveLength(3)
   })

   it("exits 3 with one line on stderr when nothing arrives before the timeout", async () => {
      serve(harness, [[squawk(3, janAgent)]])

      const exitCode = await finish(
         harness.run("watch", "--site", "feat/login", "--timeout", "30", "--interval", "10")
      )

      expect(exitCode).toBe(3)
      expect(harness.stdout()).toBe("")
      expect(harness.stderr()).toContain("No squawk on feat/login needs attention after 30 s")
   })

   it("retries after network errors and server failures", async () => {
      serve(harness, [new TypeError("fetch failed"), [squawk(3, reviewer)]])

      const exitCode = await finish(harness.run("watch", "--site", "feat/login", "--json"))

      expect(exitCode).toBe(0)
      expect(harness.stderr()).toContain("poll failed, retrying")
      expect(JSON.parse(harness.stdout()).items[0].number).toBe(3)
   })

   it("prints the show view with the screenshot path without --json", async () => {
      serve(harness, [[squawk(3, reviewer), squawk(4, jan, { screenshot: null })]])

      const exitCode = await finish(harness.run("watch", "--site", "feat/login", "--out", "shots"))

      expect(exitCode).toBe(0)
      const output = harness.stdout()
      expect(output).toMatch(/^2 squawks on feat\/login need attention\.\n─+\n/)
      expect(output).toContain("feat/login#3  [open]")
      expect(output).toContain(`Saved to ${join(harness.directory, "shots", "feat-login-3.png")}`)
      expect(output).toContain("feat/login#4  [open]")
      expect(output).toContain("No screenshot.")
   })

   it("defaults the site to the git branch and needs one otherwise", async () => {
      expect(await harness.run("watch")).toBe(1)
      expect(harness.stderr()).toContain("Not inside a git repository")
      expect(harness.fetchMock).not.toHaveBeenCalled()

      const git = (...gitArguments: string[]) =>
         runFile("git", gitArguments, { cwd: harness.directory })
      await git("init", "--quiet", "--initial-branch", "feat/watch")
      await git(
         "-c",
         "user.name=t",
         "-c",
         "user.email=t@t",
         "commit",
         "--quiet",
         "--allow-empty",
         "-m",
         "x"
      )
      serve(harness, [[squawk(3, reviewer)]])
      expect(await finish(harness.run("watch", "--json"))).toBe(0)
      expect(JSON.parse(harness.stdout()).site).toBe("feat/watch")
   })

   it("exits 2 without a token and 1 for invalid options", async () => {
      harness = await createHarness({ environment: { SQUAWK_TOKEN: undefined } })
      expect(await harness.run("watch", "--site", "s")).toBe(2)
      expect(await harness.run("watch", "--site", "s", "--interval", "0")).toBe(1)
      expect(await harness.run("watch", "--site", "s", "--timeout", "-1")).toBe(1)
      expect(harness.fetchMock).not.toHaveBeenCalled()
   })
})

describe("needsAttention", () => {
   it("ignores what the caller's own agents wrote last and anything not open", () => {
      expect(needsAttention(squawk(1, jan), me)).toBe(true)
      expect(needsAttention(squawk(1, reviewer), me)).toBe(true)
      expect(needsAttention(squawk(1, janAgent), me)).toBe(false)
      expect(needsAttention(squawk(1, { ...janAgent, id: reviewer.id }), me)).toBe(true)
      expect(needsAttention(squawk(1, reviewer, { status: "resolved" }), me)).toBe(false)
   })

   it("compares agent tokens by token id", () => {
      const agentMe: MeResponse = {
         principal: { kind: "agent", id: "99999999-9999-4999-8999-999999999999", name: "Claude" },
         token: null
      }
      const self: Author = { kind: "agent", id: agentMe.principal.id, name: "Claude" }
      const otherAgent: Author = { ...self, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      expect(needsAttention(squawk(1, self), agentMe)).toBe(false)
      expect(needsAttention(squawk(1, otherAgent), agentMe)).toBe(true)
      expect(needsAttention(squawk(1, janAgent), agentMe)).toBe(true)
   })
})
