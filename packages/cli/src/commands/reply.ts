import { readFile } from "node:fs/promises"
import { LIMITS } from "@squawk/shared"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { CliError } from "../errors"
import { resolveRef } from "../refs"

export async function replyCommand(
   context: CommandContext,
   ref: string,
   text: string | undefined,
   options: { site?: string; file?: string }
): Promise<void> {
   const apiRef = resolveRef(ref, options.site)
   const body = await readBody(context, text, options.file)
   const client = await connect(context)
   const response = await client.addComment(apiRef, body)
   if (context.json) return printJson(context, response)
   printLine(context, `Replied to ${ref}.`)
}

/** The body comes from exactly one of: the argument, `--file PATH`, or `-` for stdin. */
async function readBody(
   context: CommandContext,
   text: string | undefined,
   file: string | undefined
): Promise<string> {
   if (text !== undefined && file !== undefined) {
      throw new CliError("Pass the reply either as text or with --file, not both.")
   }
   if (text === undefined && file === undefined) {
      throw new CliError('Missing reply text. Pass it as an argument, with --file PATH, or "-".')
   }
   const raw =
      file !== undefined
         ? await readFile(file, "utf8").catch(() => {
              throw new CliError(`Could not read ${file}.`)
           })
         : text === "-"
           ? await context.readStdin()
           : (text ?? "")
   return validateBody(raw)
}

export function validateBody(raw: string): string {
   const body = raw.trim()
   if (body === "") throw new CliError("The reply is empty.")
   if (body.length > LIMITS.bodyMaxLength) {
      throw new CliError(`The reply is longer than ${LIMITS.bodyMaxLength} characters.`)
   }
   return body
}
