import { type CommandContext, connect, printJson, printLine } from "../context"
import { resolveRef } from "../refs"

/**
 * Marks squawks as being worked on by this agent, or with `--done` clears the mark. Replying,
 * resolving or reopening clears it as well, so `--done` is for squawks left without an answer.
 */
export async function workCommand(
   context: CommandContext,
   refs: string[],
   options: { site?: string; done?: boolean }
): Promise<void> {
   const apiRefs = refs.map(ref => resolveRef(ref, options.site))
   const client = await connect(context)
   const working = options.done !== true
   for (const apiRef of apiRefs) {
      if (working) await client.claim(apiRef)
      else await client.releaseClaim(apiRef)
   }
   if (context.json) return printJson(context, { refs, working })
   const list = refs.join(", ")
   printLine(context, working ? `Working on ${list}.` : `No longer working on ${list}.`)
}
