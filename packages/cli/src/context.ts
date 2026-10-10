import { ApiClient } from "./api"
import { resolveConnection, type Environment } from "./config"
import { LOGIN_HINT, NotLoggedInError } from "./errors"

/** Everything the commands need from the outside world; tests pass a fake. */
export interface CliContext {
   environment: Environment
   cwd: string
   hostname: string
   stdout(text: string): void
   stderr(text: string): void
   readStdin(): Promise<string>
   openUrl(url: string): void
   now(): Date
}

/** A `CliContext` plus the global options of the current invocation. */
export interface CommandContext extends CliContext {
   json: boolean
   serverFlag: string | undefined
}

export function printLine(context: CommandContext, text = ""): void {
   context.stdout(`${text}\n`)
}

export function printJson(context: CommandContext, value: unknown): void {
   context.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

/** Client for authenticated commands; fails with exit code 2 when no server is configured. */
export async function connect(context: CommandContext): Promise<ApiClient> {
   const connection = await resolveConnection(context.environment, context.serverFlag)
   if (connection.server === null) {
      throw new NotLoggedInError(`No server configured. ${LOGIN_HINT}`)
   }
   return new ApiClient(connection.server, connection.token)
}
