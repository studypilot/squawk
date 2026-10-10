import type { DevicePollResponse } from "@squawk/shared"
import { ApiClient, ApiError } from "../api"
import { readConfig, resolveConnection, writeConfig } from "../config"
import { type CommandContext, printJson, printLine } from "../context"
import { CliError } from "../errors"
import { authorLabel } from "../format"

/** Device-code login (plan §6.2): print the code, open the browser, poll until decided. */
export async function loginCommand(context: CommandContext): Promise<void> {
   const { server } = await resolveConnection(context.environment, context.serverFlag)
   if (server === null) {
      throw new CliError("Which server? Run: squawk login --server https://squawk.example.com")
   }
   const client = new ApiClient(server, null)
   const start = await client.startDeviceLogin(context.hostname)

   context.stderr(
      `To log in to ${server}, open\n\n   ${start.verificationUrl}\n\n` +
         `and confirm the code ${start.userCode}. Waiting for approval…\n`
   )
   context.openUrl(start.verificationUrl)

   const intervalSeconds = Math.max(start.interval, 1)
   const attempts = Math.ceil(start.expiresIn / intervalSeconds)
   for (let attempt = 0; attempt < attempts; attempt++) {
      await sleep(intervalSeconds * 1000)
      const result = await pollOnce(client, start.deviceCode)
      if (result.status === "pending") continue
      if (result.status === "denied") throw new CliError("The login was denied.")
      if (result.status === "expired") break

      await writeConfig(context.environment, { server, token: result.token })
      if (context.json) {
         printJson(context, { server, principal: result.principal, expiresAt: result.expiresAt })
      } else {
         printLine(
            context,
            `Logged in to ${server} as ${authorLabel(result.principal)} <${result.principal.email}>.`
         )
      }
      if (context.environment.SQUAWK_TOKEN) {
         context.stderr("Note: SQUAWK_TOKEN is set and takes precedence over the stored token.\n")
      }
      return
   }
   throw new CliError('The login code expired. Run "squawk login" again.')
}

/** A rate-limited poll counts as still pending; the next attempt waits another interval. */
async function pollOnce(client: ApiClient, deviceCode: string): Promise<DevicePollResponse> {
   try {
      return await client.pollDeviceLogin(deviceCode)
   } catch (error) {
      if (error instanceof ApiError && error.code === "rate_limited") return { status: "pending" }
      throw error
   }
}

function sleep(milliseconds: number): Promise<void> {
   return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function logoutCommand(context: CommandContext): Promise<void> {
   const config = await readConfig(context.environment)
   if (config.token === undefined) {
      printLine(context, "Not logged in.")
      return
   }
   await writeConfig(context.environment, { server: config.server })
   printLine(context, `Logged out of ${config.server ?? "the server"}.`)
   if (context.environment.SQUAWK_TOKEN) {
      context.stderr("Note: SQUAWK_TOKEN is still set in the environment.\n")
   }
}
