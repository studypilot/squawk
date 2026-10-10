import type { ListSquawksResponse, Squawk } from "@squawk/shared"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { authorLabel, firstLine, relativeTime, renderTable, truncate } from "../format"

export interface ListOptions {
   site: string
   status: "open" | "resolved" | "all"
   page?: string
   limit?: number
   all?: boolean
}

export async function listCommand(context: CommandContext, options: ListOptions): Promise<void> {
   const client = await connect(context)
   const parameters = {
      site: options.site,
      status: options.status,
      page: options.page,
      limit: options.limit
   }
   let response = await client.listSquawks(parameters)
   const items = [...response.items]
   while (options.all && response.nextCursor !== null) {
      response = await client.listSquawks({ ...parameters, cursor: response.nextCursor })
      items.push(...response.items)
   }
   const result: ListSquawksResponse = { items, nextCursor: response.nextCursor }

   if (context.json) return printJson(context, result)
   printSquawkTable(context, result, options)
}

function printSquawkTable(
   context: CommandContext,
   result: ListSquawksResponse,
   options: ListOptions
): void {
   const statusLabel = options.status === "all" ? "" : `${options.status} `
   if (result.items.length === 0) {
      return printLine(context, `No ${statusLabel}squawks on site ${options.site}.`)
   }
   const rows = result.items.map((squawk: Squawk) => [
      `#${squawk.number}`,
      squawk.status,
      truncate(squawk.page, 30),
      truncate(firstLine(squawk.body), 50),
      truncate(authorLabel(squawk.author), 24),
      relativeTime(squawk.createdAt, context.now()),
      String(squawk.commentCount)
   ])
   printLine(
      context,
      renderTable(["#", "STATUS", "PAGE", "BODY", "AUTHOR", "AGE", "REPLIES"], rows)
   )
   if (result.nextCursor !== null) {
      printLine(context, `\nMore squawks available. Use --all to fetch every page.`)
   }
}
