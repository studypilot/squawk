import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import type { MeResponse, Squawk, SquawkDetail } from "@squawk/shared"
import { ApiError, NetworkError, type ApiClient } from "../api"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { WatchTimeoutError } from "../errors"
import { saveScreenshot, screenshotFileName } from "./screenshot"
import { renderDetail } from "./show"
import { currentBranchSiteKey } from "./site-key"

export interface WatchOptions {
   site?: string
   /** Seconds; 0 waits forever. */
   timeout: number
   /** Seconds between polls. */
   interval: number
   out: string
   /** False with `--no-claim`. */
   claim: boolean
}

export type WatchItem = SquawkDetail & { screenshotPath: string | null }

export interface WatchResult {
   site: string
   checkedAt: string
   me: MeResponse
   items: WatchItem[]
}

const SEPARATOR = "─".repeat(72)

/**
 * Waits until at least one open squawk on the site needs attention, then prints all of them with
 * their screenshots saved to `--out` and exits 0. Exits 3 when the timeout passes first. Nothing
 * is written to stdout while waiting, so `--json` output stays parseable.
 */
export async function watchCommand(context: CommandContext, options: WatchOptions): Promise<void> {
   const site = options.site ?? (await currentBranchSiteKey(context.cwd))
   const client = await connect(context)
   const timeoutLabel = options.timeout === 0 ? "no timeout" : `timeout ${options.timeout} s`
   context.stderr(
      `Watching ${site} for squawks that need attention (every ${options.interval} s, ${timeoutLabel})…\n`
   )

   const deadline = options.timeout === 0 ? Infinity : Date.now() + options.timeout * 1000
   let me: MeResponse | null = null
   while (true) {
      try {
         const currentMe: MeResponse = me ?? (await client.me())
         me = currentMe
         const waiting = (await listOpenSquawks(client, site)).filter(squawk =>
            needsAttention(squawk, currentMe)
         )
         if (waiting.length > 0) {
            if (options.claim) await claimAll(context, client, waiting)
            const items = await collectItems(client, waiting, resolve(context.cwd, options.out))
            const result = { site, checkedAt: new Date().toISOString(), me: currentMe, items }
            return printResult(context, result)
         }
      } catch (error) {
         if (!isTransient(error)) throw error
         context.stderr(`squawk: poll failed, retrying: ${(error as Error).message}\n`)
      }

      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await sleep(Math.min(options.interval * 1000, remaining))
   }
   throw new WatchTimeoutError(
      `No squawk on ${site} needs attention after ${options.timeout} s. Run watch again.`
   )
}

/**
 * Open and last written by someone other than "me as an agent": for a login token that is any of
 * my CLI agents (`agent` set on my own user), for an agent token the token itself. A squawk the
 * agent only asked a question on therefore comes back once a human answers.
 */
export function needsAttention(squawk: Squawk, me: MeResponse): boolean {
   if (squawk.status !== "open") return false
   const last = squawk.lastAuthor
   if (me.principal.kind === "agent") return !(last.kind === "agent" && last.id === me.principal.id)
   return !(last.kind === "user" && last.id === me.principal.id && last.agent !== null)
}

/**
 * Marks every returned squawk as being worked on, before the details are loaded so the printed
 * `working` field already shows the claim. Tokens that may not claim only get a hint.
 */
async function claimAll(context: CommandContext, client: ApiClient, squawks: Squawk[]) {
   for (const squawk of squawks) {
      try {
         await client.claim(squawk.id)
      } catch (error) {
         if (!(error instanceof ApiError) || error.status !== 403) throw error
         context.stderr(`squawk: could not mark the squawks as being worked on: ${error.message}\n`)
         return
      }
   }
}

async function listOpenSquawks(client: ApiClient, site: string): Promise<Squawk[]> {
   const items: Squawk[] = []
   let cursor: string | undefined
   do {
      const page = await client.listSquawks({ site, status: "open", limit: 200, cursor })
      items.push(...page.items)
      cursor = page.nextCursor ?? undefined
   } while (cursor !== undefined)
   return items
}

/** Oldest first, each with its full thread and the screenshot saved to `directory`. */
async function collectItems(
   client: ApiClient,
   squawks: Squawk[],
   directory: string
): Promise<WatchItem[]> {
   await mkdir(directory, { recursive: true })
   const oldestFirst = [...squawks].sort((left, right) => left.number - right.number)
   const items: WatchItem[] = []
   for (const squawk of oldestFirst) {
      const detail = await client.getSquawk(squawk.id)
      let screenshotPath: string | null = null
      if (detail.screenshot !== null) {
         screenshotPath = resolve(directory, screenshotFileName(detail))
         await saveScreenshot(client, detail.screenshot, screenshotPath)
      }
      items.push({ ...detail, screenshotPath })
   }
   return items
}

function printResult(context: CommandContext, result: WatchResult): void {
   if (context.json) return printJson(context, result)
   const count = result.items.length
   printLine(context, `${count} squawk${count === 1 ? "" : "s"} on ${result.site} need attention.`)
   for (const item of result.items) {
      printLine(context, SEPARATOR)
      printLine(context, renderDetail(item, context.now(), item.screenshotPath ?? undefined))
   }
   printLine(context, SEPARATOR)
}

/** Unreachable servers and server-side failures are retried; anything else is a real error. */
function isTransient(error: unknown): boolean {
   if (error instanceof NetworkError) return true
   return error instanceof ApiError && (error.status >= 500 || error.status === 429)
}

function sleep(milliseconds: number): Promise<void> {
   return new Promise(done => setTimeout(done, milliseconds))
}
