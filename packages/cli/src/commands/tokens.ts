import type { Token } from "@squawk/shared"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { relativeTime, renderTable } from "../format"

export async function tokenCreateCommand(
   context: CommandContext,
   options: { name: string; site?: string; expiresDays?: number }
): Promise<void> {
   const client = await connect(context)
   const response = await client.createToken({
      name: options.name,
      siteKey: options.site ?? null,
      expiresInDays: options.expiresDays ?? null
   })
   if (context.json) return printJson(context, response)

   const scope = response.token.siteKey === null ? "all sites" : `site ${response.token.siteKey}`
   const expiry =
      response.token.expiresAt === null
         ? "never expires"
         : `expires ${response.token.expiresAt.slice(0, 10)}`
   printLine(context, `Created token "${response.token.name}" (${scope}, ${expiry}).`)
   printLine(context, "This is the only time the secret is shown:")
   printLine(context)
   printLine(context, `   ${response.secret}`)
   printLine(context)
   printLine(context, "Give it to an agent as an environment variable:")
   printLine(context, `   export SQUAWK_SERVER=${client.server}`)
   printLine(context, `   export SQUAWK_TOKEN=${response.secret}`)
}

export async function tokenListCommand(context: CommandContext): Promise<void> {
   const client = await connect(context)
   const tokens = await client.listTokens()
   if (context.json) return printJson(context, { items: tokens })
   if (tokens.length === 0) return printLine(context, "No tokens.")

   const now = context.now()
   const rows = tokens.map((token: Token) => [
      token.id,
      token.name,
      token.prefix,
      token.kind,
      token.siteKey ?? "all",
      token.expiresAt === null ? "never" : token.expiresAt.slice(0, 10),
      token.lastUsedAt === null ? "never" : relativeTime(token.lastUsedAt, now),
      tokenState(token, now)
   ])
   printLine(
      context,
      renderTable(["ID", "NAME", "PREFIX", "KIND", "SITE", "EXPIRES", "LAST USED", "STATE"], rows)
   )
}

function tokenState(token: Token, now: Date): string {
   if (token.revokedAt !== null) return "revoked"
   if (token.expiresAt !== null && new Date(token.expiresAt) <= now) return "expired"
   return "active"
}

export async function tokenRevokeCommand(context: CommandContext, id: string): Promise<void> {
   const client = await connect(context)
   const response = await client.revokeToken(id)
   if (context.json) return printJson(context, response)
   printLine(context, `Revoked token ${id}.`)
}
