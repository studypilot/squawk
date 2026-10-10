import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
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
   const image = await client.downloadScreenshot(detail.screenshot.url)
   const fileName = options.out ?? `squawk-${siteSlug(detail.siteKey)}-${detail.number}.png`
   const path = resolve(context.cwd, fileName)
   await writeFile(path, image)

   if (context.json) return printJson(context, { path, screenshot: detail.screenshot })
   printLine(context, path)
}
