import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
   createHarness,
   errorResponse,
   type Harness,
   jan,
   janAgent,
   jsonResponse,
   recordedRequest,
   SERVER,
   squawkFixture,
   TOKEN,
   tokenFixture
} from "./test-harness"

const runFile = promisify(execFile)
const authorization = `Bearer ${TOKEN}`
const detailUrl = `${SERVER}/api/squawks/feat%2Flogin%233`

describe("squawk CLI", () => {
   let harness: Harness

   beforeEach(async () => {
      harness = await createHarness()
   })

   afterEach(async () => {
      await harness.cleanup()
   })

   describe("authentication and errors", () => {
      it("prints help that mentions agents and exits 0", async () => {
         expect(await harness.run("--help")).toBe(0)
         expect(harness.stdout()).toContain("coding agents")
         expect(harness.stdout()).toContain("site-key")
      })

      it("prints the version", async () => {
         expect(await harness.run("--version")).toBe(0)
         expect(harness.stdout()).toMatch(/^\d+\.\d+\.\d+\n$/)
      })

      it("sends the bearer token and prints whoami", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({
               principal: jan,
               token: {
                  id: "66666666-6666-4666-8666-666666666666",
                  name: "CLI test-host",
                  kind: "login",
                  siteKey: null
               }
            })
         )
         expect(await harness.run("whoami")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0)).toEqual({
            url: `${SERVER}/api/me`,
            method: "GET",
            headers: { accept: "application/json", authorization },
            body: undefined
         })
         expect(harness.stdout()).toBe(
            `Logged in to ${SERVER} as Jan <jan@studypilot.app>.\n` +
               "Token: CLI test-host (login, all sites)\n"
         )
      })

      it("exits 2 without a server", async () => {
         harness = await createHarness({ environment: { SQUAWK_SERVER: undefined } })
         expect(await harness.run("sites")).toBe(2)
         expect(harness.stderr()).toContain("squawk login")
         expect(harness.fetchMock).not.toHaveBeenCalled()
      })

      it("exits 2 without a token", async () => {
         harness = await createHarness({ environment: { SQUAWK_TOKEN: undefined } })
         expect(await harness.run("sites")).toBe(2)
         expect(harness.stderr()).toContain("Not logged in")
         expect(harness.stderr()).toContain("SQUAWK_TOKEN")
         expect(harness.fetchMock).not.toHaveBeenCalled()
      })

      it("maps 401 to exit 2", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            errorResponse(401, "unauthorized", "Token revoked")
         )
         expect(await harness.run("sites")).toBe(2)
         expect(harness.stderr()).toContain("rejected the token: Token revoked")
      })

      it("maps API errors to readable messages and exit 1", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            errorResponse(404, "not_found", "Squawk not found")
         )
         expect(await harness.run("show", "feat/login#3")).toBe(1)
         expect(harness.stderr()).toBe("squawk: Squawk not found (not_found)\n")
      })

      it("reports unreachable servers", async () => {
         harness.fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
         expect(await harness.run("sites")).toBe(1)
         expect(harness.stderr()).toContain(`Could not reach ${SERVER}: fetch failed`)
      })

      it("rejects responses that do not match the contract", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ key: 1 }] }))
         expect(await harness.run("sites")).toBe(1)
         expect(harness.stderr()).toContain("Unexpected response from GET /api/sites")
      })

      it("applies --server to every command", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }))
         expect(await harness.run("sites", "--server", "http://localhost:3000/")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0).url).toBe("http://localhost:3000/api/sites")
      })
   })

   describe("sites and list", () => {
      it("prints sites as a table", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({
               items: [
                  {
                     key: "feat/login",
                     displayName: null,
                     openCount: 2,
                     resolvedCount: 5,
                     unreadCount: 1,
                     lastActivityAt: "2026-10-10T09:00:00.000Z",
                     createdAt: "2026-10-01T09:00:00.000Z"
                  }
               ]
            })
         )
         expect(await harness.run("sites")).toBe(0)
         expect(harness.stdout()).toBe(
            "SITE        NAME  OPEN  RESOLVED  LAST ACTIVITY\n" +
               "feat/login        2     5         3h ago\n"
         )
      })

      it("lists squawks with the right query and a table", async () => {
         const squawk = squawkFixture({ body: "First line\nsecond line" })
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({ items: [squawk], nextCursor: "cursor-2" })
         )
         expect(
            await harness.run(
               "list",
               "--site",
               "feat/login",
               "--page",
               "/settings",
               "--limit",
               "10"
            )
         ).toBe(0)
         const request = recordedRequest(harness.fetchMock, 0)
         expect(request.method).toBe("GET")
         expect(request.url).toBe(
            `${SERVER}/api/squawks?site=feat%2Flogin&status=open&page=%2Fsettings&limit=10`
         )
         expect(request.headers.authorization).toBe(authorization)
         expect(harness.stdout()).toBe(
            "#   STATUS  PAGE       BODY        AUTHOR  AGE     REPLIES\n" +
               "#3  open    /settings  First line  Jan     2h ago  1\n" +
               "\nMore squawks available. Use --all to fetch every page.\n"
         )
      })

      it("follows cursors with --all and prints the combined JSON", async () => {
         harness.fetchMock
            .mockResolvedValueOnce(
               jsonResponse({ items: [squawkFixture({ number: 1 })], nextCursor: "next" })
            )
            .mockResolvedValueOnce(
               jsonResponse({ items: [squawkFixture({ number: 2 })], nextCursor: null })
            )
         expect(
            await harness.run("list", "--site", "s", "--status", "all", "--all", "--json")
         ).toBe(0)
         expect(recordedRequest(harness.fetchMock, 1).url).toBe(
            `${SERVER}/api/squawks?site=s&status=all&cursor=next`
         )
         const output = JSON.parse(harness.stdout())
         expect(output.items.map((item: { number: number }) => item.number)).toEqual([1, 2])
         expect(output.nextCursor).toBeNull()
      })

      it("says so when nothing is open", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }))
         expect(await harness.run("list", "--site", "s")).toBe(0)
         expect(harness.stdout()).toBe("No open squawks on site s.\n")
      })

      it("validates --limit and --status before calling the server", async () => {
         expect(await harness.run("list", "--site", "s", "--limit", "0")).toBe(1)
         expect(await harness.run("list", "--site", "s", "--status", "closed")).toBe(1)
         expect(await harness.run("list", "--site", "s", "--status", "draft")).toBe(1)
         expect(harness.fetchMock).not.toHaveBeenCalled()
      })

      it("marks squawks an agent wrote on someone's behalf", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({ items: [squawkFixture({ author: janAgent })], nextCursor: null })
         )
         expect(await harness.run("list", "--site", "feat/login")).toBe(0)
         expect(harness.stdout()).toContain("Agent for Jan")
      })

      it("marks unread squawks and shows who is working on them", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({
               items: [
                  squawkFixture({
                     number: 4,
                     unread: true,
                     working: { by: janAgent, since: "2026-10-10T11:57:00.000Z" }
                  }),
                  squawkFixture({ number: 3 })
               ],
               nextCursor: null
            })
         )
         expect(await harness.run("list", "--site", "feat/login")).toBe(0)
         expect(harness.stdout()).toBe(
            "  #   STATUS  PAGE       BODY                                  AUTHOR  AGE     REPLIES  WORKING\n" +
               "• #4  open    /settings  The save button overlaps the footer.  Jan     2h ago  1        ⟳ Agent for Jan\n" +
               "  #3  open    /settings  The save button overlaps the footer.  Jan     2h ago  1\n"
         )
      })
   })

   describe("show and screenshot", () => {
      it("shows metadata, anchor, replies and the screenshot hint", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(squawkFixture()))
         expect(await harness.run("show", "#3", "--site", "feat/login")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0).url).toBe(detailUrl)
         const output = harness.stdout()
         expect(output).toContain("feat/login#3  [open]")
         expect(output).toContain("URL:       https://preview.test/settings")
         expect(output).toContain("Viewport:  390×844 @3x")
         expect(output).toContain(
            'Anchor:    <button>  testId=save-button  css=main > button.save  text="Save"'
         )
         expect(output).toContain("Replies (1):")
         expect(output).toContain("    Only on small screens.")
         expect(output.match(/The save button overlaps the footer\./g)).toHaveLength(1)
         expect(output).toContain("squawk screenshot 'feat/login#3'")
      })

      it("shows agent replies as the agent, not the user", async () => {
         const detail = squawkFixture({
            comments: [squawkFixture().comments[0]!].map(comment => ({
               ...comment,
               author: janAgent
            }))
         })
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(detail))
         expect(await harness.run("show", "feat/login#3")).toBe(0)
         expect(harness.stdout()).toContain("  Agent for Jan, 1h ago")
      })

      it("shows who is working on it and whether it is unread", async () => {
         const detail = squawkFixture({
            unread: true,
            working: { by: janAgent, since: "2026-10-10T11:57:00.000Z" }
         })
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(detail))
         expect(await harness.run("show", "feat/login#3")).toBe(0)
         expect(harness.stdout()).toContain("Working:   Agent for Jan, since 3 min\n")
         expect(harness.stdout()).toContain("Unread:    yes\n")

         harness.fetchMock.mockResolvedValueOnce(jsonResponse(squawkFixture()))
         expect(await harness.run("show", "feat/login#3")).toBe(0)
         expect(harness.stdout().match(/Working:|Unread:/g)).toHaveLength(2)
      })

      it("prints the raw API object with --json", async () => {
         const detail = { ...squawkFixture(), futureField: "kept" }
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(detail))
         expect(await harness.run("show", "feat/login#3", "--json")).toBe(0)
         expect(JSON.parse(harness.stdout())).toEqual(detail)
      })

      it("needs --site for a bare number", async () => {
         expect(await harness.run("show", "3")).toBe(1)
         expect(harness.stderr()).toContain("needs --site")
      })

      it("downloads the screenshot to the default path", async () => {
         const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
         harness.fetchMock
            .mockResolvedValueOnce(jsonResponse(squawkFixture()))
            .mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png" } }))
         expect(await harness.run("screenshot", "feat/login#3")).toBe(0)
         const download = recordedRequest(harness.fetchMock, 1)
         expect(download.url).toBe(`${SERVER}/api/screenshots/44444444-4444-4444-8444-444444444444`)
         expect(download.headers.authorization).toBe(authorization)
         const path = join(harness.directory, "squawk-feat-login-3.png")
         expect(harness.stdout()).toBe(`${path}\n`)
         expect(new Uint8Array(await readFile(path))).toEqual(png)
      })

      it("honours --out", async () => {
         harness.fetchMock
            .mockResolvedValueOnce(jsonResponse(squawkFixture()))
            .mockResolvedValueOnce(new Response(new Uint8Array([1])))
         expect(await harness.run("screenshot", "feat/login#3", "--out", "shot.png")).toBe(0)
         expect(harness.stdout()).toBe(`${join(harness.directory, "shot.png")}\n`)
      })

      it("fails when the squawk has no screenshot", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(squawkFixture({ screenshot: null })))
         expect(await harness.run("screenshot", "feat/login#3")).toBe(1)
         expect(harness.stderr()).toContain("has no screenshot")
         expect(harness.fetchMock).toHaveBeenCalledTimes(1)
      })
   })

   describe("work", () => {
      const noContent = (): Response => new Response(null, { status: 204 })

      it("claims several squawks at once", async () => {
         harness.fetchMock.mockResolvedValueOnce(noContent()).mockResolvedValueOnce(noContent())
         expect(await harness.run("work", "feat/login#3", "#4", "--site", "feat/login")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0)).toMatchObject({
            url: `${detailUrl}/working`,
            method: "PUT",
            headers: { accept: "application/json", authorization }
         })
         expect(recordedRequest(harness.fetchMock, 1)).toMatchObject({
            url: `${SERVER}/api/squawks/feat%2Flogin%234/working`,
            method: "PUT"
         })
         expect(harness.stdout()).toBe("Working on feat/login#3, #4.\n")
      })

      it("releases with --done and prints JSON", async () => {
         harness.fetchMock.mockResolvedValueOnce(noContent())
         expect(await harness.run("work", "feat/login#3", "--done", "--json")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0)).toMatchObject({
            url: `${detailUrl}/working`,
            method: "DELETE"
         })
         expect(JSON.parse(harness.stdout())).toEqual({ refs: ["feat/login#3"], working: false })
      })

      it("reports a token that may not claim", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            errorResponse(403, "forbidden", "Only agents claim squawks")
         )
         expect(await harness.run("work", "feat/login#3")).toBe(1)
         expect(harness.stderr()).toBe("squawk: Only agents claim squawks (forbidden)\n")
      })

      it("validates every reference before calling the server", async () => {
         expect(await harness.run("work", "feat/login#3", "3")).toBe(1)
         expect(harness.fetchMock).not.toHaveBeenCalled()
      })
   })

   describe("reply, resolve, reopen", () => {
      const commentCreated = (): Response => jsonResponse({ id: "c" }, 201)

      it("replies with the argument text", async () => {
         harness.fetchMock.mockResolvedValueOnce(commentCreated())
         expect(await harness.run("reply", "feat/login#3", "Fixed in abc1234.")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0)).toEqual({
            url: `${detailUrl}/comments`,
            method: "POST",
            headers: {
               accept: "application/json",
               authorization,
               "content-type": "application/json"
            },
            body: { body: "Fixed in abc1234." }
         })
         expect(harness.stdout()).toBe("Replied to feat/login#3.\n")
      })

      it("reads the reply from stdin", async () => {
         harness = await createHarness({ stdin: "From stdin\n\n" })
         harness.fetchMock.mockResolvedValueOnce(commentCreated())
         expect(await harness.run("reply", "#3", "-", "--site", "feat/login")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0).body).toEqual({ body: "From stdin" })
      })

      it("reads the reply from a file", async () => {
         const file = join(harness.directory, "reply.md")
         await writeFile(file, "From a file")
         harness.fetchMock.mockResolvedValueOnce(commentCreated())
         expect(await harness.run("reply", "feat/login#3", "--file", file)).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0).body).toEqual({ body: "From a file" })
      })

      it("rejects ambiguous or empty replies", async () => {
         expect(await harness.run("reply", "feat/login#3", "text", "--file", "x")).toBe(1)
         expect(await harness.run("reply", "feat/login#3", "   ")).toBe(1)
         expect(await harness.run("reply", "feat/login#3")).toBe(1)
         expect(harness.fetchMock).not.toHaveBeenCalled()
      })

      it("comments first, then resolves", async () => {
         harness.fetchMock
            .mockResolvedValueOnce(commentCreated())
            .mockResolvedValueOnce(jsonResponse(squawkFixture({ status: "resolved" })))
         expect(await harness.run("resolve", "feat/login#3", "--comment", "Done in abc1234.")).toBe(
            0
         )
         const comment = recordedRequest(harness.fetchMock, 0)
         expect([comment.method, comment.url, comment.body]).toEqual([
            "POST",
            `${detailUrl}/comments`,
            { body: "Done in abc1234." }
         ])
         const patch = recordedRequest(harness.fetchMock, 1)
         expect([patch.method, patch.url, patch.body]).toEqual([
            "PATCH",
            detailUrl,
            { status: "resolved" }
         ])
         expect(harness.stdout()).toBe("Resolved feat/login#3.\n")
      })

      it("does not resolve when the comment fails", async () => {
         harness.fetchMock.mockResolvedValueOnce(errorResponse(400, "validation", "Too long"))
         expect(await harness.run("resolve", "feat/login#3", "--comment", "x")).toBe(1)
         expect(harness.fetchMock).toHaveBeenCalledTimes(1)
      })

      it("reopens", async () => {
         harness.fetchMock.mockResolvedValueOnce(jsonResponse(squawkFixture()))
         expect(await harness.run("reopen", "feat/login#3")).toBe(0)
         const patch = recordedRequest(harness.fetchMock, 0)
         expect([patch.method, patch.body]).toEqual(["PATCH", { status: "open" }])
      })
   })

   describe("tokens", () => {
      it("creates a token and prints the secret once", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({ token: tokenFixture(), secret: "sqk_secretsecret" }, 201)
         )
         expect(
            await harness.run(
               "token",
               "create",
               "--name",
               "Claude on feat/login",
               "--site",
               "feat/login",
               "--expires-days",
               "14"
            )
         ).toBe(0)
         const request = recordedRequest(harness.fetchMock, 0)
         expect([request.method, request.url, request.body]).toEqual([
            "POST",
            `${SERVER}/api/tokens`,
            { name: "Claude on feat/login", siteKey: "feat/login", expiresInDays: 14 }
         ])
         expect(harness.stdout()).toContain("   sqk_secretsecret\n")
         expect(harness.stdout()).toContain("export SQUAWK_TOKEN=sqk_secretsecret")
      })

      it("sends nulls for omitted token options", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({ token: tokenFixture({ siteKey: null }), secret: "sqk_s" })
         )
         expect(await harness.run("token", "create", "--name", "ci")).toBe(0)
         expect(recordedRequest(harness.fetchMock, 0).body).toEqual({
            name: "ci",
            siteKey: null,
            expiresInDays: null
         })
      })

      it("lists tokens", async () => {
         harness.fetchMock.mockResolvedValueOnce(
            jsonResponse({
               items: [tokenFixture(), tokenFixture({ revokedAt: "2026-10-09T00:00:00.000Z" })]
            })
         )
         expect(await harness.run("token", "list")).toBe(0)
         const lines = harness.stdout().trimEnd().split("\n")
         expect(lines[0]).toMatch(
            /^ID\s+NAME\s+PREFIX\s+KIND\s+SITE\s+EXPIRES\s+LAST USED\s+STATE$/
         )
         expect(lines[1]).toMatch(/sqk_a1b2c3d4\s+agent\s+feat\/login\s+never\s+30m ago\s+active$/)
         expect(lines[2]).toMatch(/revoked$/)
      })

      it("revokes a token", async () => {
         harness.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
         expect(await harness.run("token", "revoke", tokenFixture().id)).toBe(0)
         const request = recordedRequest(harness.fetchMock, 0)
         expect([request.method, request.url]).toEqual([
            "DELETE",
            `${SERVER}/api/tokens/${tokenFixture().id}`
         ])
         expect(harness.stdout()).toBe(`Revoked token ${tokenFixture().id}.\n`)
      })
   })

   describe("site-key and logout", () => {
      it("derives the site key from the git branch", async () => {
         await runFile("git", ["init", "--quiet", "--initial-branch", "feat/login+2fa"], {
            cwd: harness.directory
         })
         await runFile(
            "git",
            [
               "-c",
               "user.name=t",
               "-c",
               "user.email=t@t",
               "commit",
               "--quiet",
               "--allow-empty",
               "-m",
               "x"
            ],
            { cwd: harness.directory }
         )
         expect(await harness.run("site-key")).toBe(0)
         expect(harness.stdout()).toBe("feat/login-2fa\n")
      })

      it("fails outside a git repository", async () => {
         expect(await harness.run("site-key")).toBe(1)
         expect(harness.stderr()).toContain("Not inside a git repository")
      })

      it("removes the token but keeps the server", async () => {
         const path = join(harness.directory, "squawk", "config.json")
         await mkdir(join(harness.directory, "squawk"))
         await writeFile(path, JSON.stringify({ server: SERVER, token: "sqk_x" }))
         expect(await harness.run("logout")).toBe(0)
         expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ server: SERVER })
         expect(harness.stdout()).toBe(`Logged out of ${SERVER}.\n`)
      })
   })
})
