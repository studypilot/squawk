import { type CommandContext, connect, printJson, printLine } from "../context"
import { resolveRef } from "../refs"
import { validateBody } from "./reply"

/** Optionally comments first, then marks the squawk resolved. */
export async function resolveCommand(
   context: CommandContext,
   ref: string,
   options: { site?: string; comment?: string }
): Promise<void> {
   const apiRef = resolveRef(ref, options.site)
   const comment = options.comment === undefined ? undefined : validateBody(options.comment)
   const client = await connect(context)
   if (comment !== undefined) await client.addComment(apiRef, comment)
   const response = await client.setStatus(apiRef, "resolved")
   if (context.json) return printJson(context, response)
   printLine(context, `Resolved ${ref}.`)
}

export async function reopenCommand(
   context: CommandContext,
   ref: string,
   options: { site?: string }
): Promise<void> {
   const apiRef = resolveRef(ref, options.site)
   const client = await connect(context)
   const response = await client.setStatus(apiRef, "open")
   if (context.json) return printJson(context, response)
   printLine(context, `Reopened ${ref}.`)
}
