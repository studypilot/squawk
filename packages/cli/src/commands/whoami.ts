import { type CommandContext, connect, printJson, printLine } from "../context"
import { authorLabel } from "../format"

export async function whoamiCommand(context: CommandContext): Promise<void> {
   const client = await connect(context)
   const me = await client.me()
   if (context.json) return printJson(context, me)

   const principal =
      me.principal.kind === "user"
         ? `${authorLabel(me.principal)} <${me.principal.email}>`
         : authorLabel(me.principal)
   printLine(context, `Logged in to ${client.server} as ${principal}.`)
   if (me.token === null) return
   const restriction = me.token.siteKey === null ? "all sites" : `site ${me.token.siteKey}`
   printLine(context, `Token: ${me.token.name} (${me.token.kind}, ${restriction})`)
}
