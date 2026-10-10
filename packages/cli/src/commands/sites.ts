import { type CommandContext, connect, printJson, printLine } from "../context"
import { relativeTime, renderTable, truncate } from "../format"

export async function sitesCommand(context: CommandContext): Promise<void> {
   const client = await connect(context)
   const response = await client.listSites()
   if (context.json) return printJson(context, response)
   if (response.items.length === 0) return printLine(context, "No sites yet.")

   const rows = response.items.map(site => [
      site.key,
      truncate(site.displayName ?? "", 30),
      String(site.openCount),
      String(site.resolvedCount),
      site.lastActivityAt === null ? "" : relativeTime(site.lastActivityAt, context.now())
   ])
   printLine(context, renderTable(["SITE", "NAME", "OPEN", "RESOLVED", "LAST ACTIVITY"], rows))
}
