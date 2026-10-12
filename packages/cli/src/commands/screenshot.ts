import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { SquawkDetail } from "@squawk/shared"
import type { ApiClient } from "../api"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { CliError } from "../errors"
import { siteSlug } from "../format"
import { resolveRef } from "../refs"

export async function screenshotCommand(
   context: CommandContext,
   ref: string,
   options: { site?: string; out?: string }
): Promise<void> {
   const apiRef = resolveRef(ref, options.site)
   const client = await connect(context)
   const detail = await client.getSquawk(apiRef)
   if (detail.screenshot === null) {
      throw new CliError(`Squawk ${detail.siteKey}#${detail.number} has no screenshot.`)
   }
   const fileName = options.out ?? `squawk-${screenshotFileName(detail)}`
   const path = resolve(context.cwd, fileName)
   await saveScreenshot(client, detail.screenshot, path)

   if (context.json) return printJson(context, { path, screenshot: detail.screenshot })
   printLine(context, path)
}

/** `<site>-<n>.png` with the site key made file-name safe. */
export function screenshotFileName(detail: Pick<SquawkDetail, "siteKey" | "number">): string {
   return `${siteSlug(detail.siteKey)}-${detail.number}.png`
}

export async function saveScreenshot(
   client: ApiClient,
   screenshot: NonNullable<SquawkDetail["screenshot"]>,
   path: string
): Promise<void> {
   await writeFile(path, await client.downloadScreenshot(screenshot.url))
}
