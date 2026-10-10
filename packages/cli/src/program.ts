import { Command, CommanderError, InvalidArgumentError, Option } from "commander"
import { version } from "../package.json"
import { listCommand } from "./commands/list"
import { loginCommand, logoutCommand } from "./commands/login"
import { replyCommand } from "./commands/reply"
import { screenshotCommand } from "./commands/screenshot"
import { showCommand } from "./commands/show"
import { siteKeyCommand } from "./commands/site-key"
import { sitesCommand } from "./commands/sites"
import { reopenCommand, resolveCommand } from "./commands/status"
import { tokenCreateCommand, tokenListCommand, tokenRevokeCommand } from "./commands/tokens"
import { whoamiCommand } from "./commands/whoami"
import type { CliContext, CommandContext } from "./context"
import { CliError } from "./errors"

const DESCRIPTION =
   "Command-line client for Squawk, the self-hosted comment layer for preview deployments. " +
   'Reviewers pin comments ("squawks") with screenshots onto a test build; humans and coding ' +
   "agents use this CLI to list them, read the thread and screenshot, reply, and resolve them " +
   'once fixed. Agents authenticate with SQUAWK_SERVER and SQUAWK_TOKEN, humans run "squawk login".'

const REF_HELP = "uuid, <site>#<n>, or #<n> with --site"

/** Runs the CLI and returns the process exit code. */
export async function runCli(argv: string[], context: CliContext): Promise<number> {
   try {
      await createProgram(context).parseAsync(argv, { from: "user" })
      return 0
   } catch (error) {
      if (error instanceof CommanderError) return error.exitCode
      if (error instanceof CliError) {
         context.stderr(`squawk: ${error.message}\n`)
         return error.exitCode
      }
      context.stderr(`squawk: unexpected error: ${error instanceof Error ? error.stack : error}\n`)
      return 1
   }
}

export function createProgram(context: CliContext): Command {
   const program = new Command("squawk")
      .description(DESCRIPTION)
      .version(version)
      .option("--server <url>", "Squawk server URL (default: SQUAWK_SERVER or the stored login)")
      .option("--json", "print raw API JSON instead of human-readable output")
      .showHelpAfterError()
      .exitOverride()
      .configureOutput({ writeOut: context.stdout, writeErr: context.stderr })

   const withContext =
      <Arguments extends unknown[]>(
         handler: (commandContext: CommandContext, ...rest: Arguments) => Promise<void>
      ) =>
      (...actionArguments: unknown[]): Promise<void> => {
         const command = actionArguments.at(-1) as Command
         const globals = command.optsWithGlobals<{ server?: string; json?: boolean }>()
         const commandContext = {
            ...context,
            json: globals.json === true,
            serverFlag: globals.server
         }
         return handler(commandContext, ...(actionArguments.slice(0, -1) as Arguments))
      }

   const siteOption = new Option("--site <key>", "site key, needed for #<n> references")

   program
      .command("login")
      .description("log in through the browser (device code) and store the token")
      .action(withContext(loginCommand))

   program
      .command("logout")
      .description("remove the stored token")
      .action(withContext(logoutCommand))

   program
      .command("whoami")
      .description("show who the current token belongs to")
      .action(withContext(whoamiCommand))

   program
      .command("sites")
      .description("list sites with open and resolved counts")
      .action(withContext(sitesCommand))

   program
      .command("list")
      .description("list squawks of a site")
      .requiredOption("--site <key>", "site key")
      .addOption(
         new Option("--status <status>", "filter by status")
            .choices(["open", "resolved", "all"])
            .default("open")
      )
      .option("--page <key>", "only squawks on this page key")
      .option("--limit <n>", "page size per request (1-200)", parseLimit)
      .option("--all", "follow cursors and fetch every page")
      .action(withContext(listCommand))

   program
      .command("show")
      .description("show a squawk with metadata, anchor and replies")
      .argument("<ref>", REF_HELP)
      .addOption(siteOption)
      .action(withContext(showCommand))

   program
      .command("screenshot")
      .description("download the screenshot of a squawk and print its path")
      .argument("<ref>", REF_HELP)
      .addOption(siteOption)
      .option("--out <path>", "target file (default: ./squawk-<site>-<n>.png)")
      .action(withContext(screenshotCommand))

   program
      .command("reply")
      .description('reply to a squawk; text as argument, with --file, or "-" for stdin')
      .argument("<ref>", REF_HELP)
      .argument("[text]", 'reply text, or "-" to read stdin')
      .addOption(siteOption)
      .option("--file <path>", "read the reply from a file")
      .action(withContext(replyCommand))

   program
      .command("resolve")
      .description("mark a squawk resolved, optionally with a final comment")
      .argument("<ref>", REF_HELP)
      .addOption(siteOption)
      .option("--comment <text>", "comment to post before resolving")
      .action(withContext(resolveCommand))

   program
      .command("reopen")
      .description("mark a squawk open again")
      .argument("<ref>", REF_HELP)
      .addOption(siteOption)
      .action(withContext(reopenCommand))

   const token = program.command("token").description("manage agent tokens (humans only)")
   token
      .command("create")
      .description("create an agent token and print its secret once")
      .requiredOption("--name <name>", "token name, shown as the author of its comments")
      .option("--site <key>", "restrict the token to one site")
      .option("--expires-days <n>", "expire after N days (default: never)", parseExpiresDays)
      .action(withContext(tokenCreateCommand))
   token
      .command("list")
      .description("list your login tokens and all agent tokens")
      .action(withContext(tokenListCommand))
   token
      .command("revoke")
      .description("revoke a token")
      .argument("<id>", "token id from `squawk token list`")
      .action(withContext(tokenRevokeCommand))

   program
      .command("site-key")
      .description("suggest a site key from the current git branch")
      .action(withContext(siteKeyCommand))

   return program
}

function parseLimit(value: string): number {
   return parseIntegerInRange(value, 1, 200)
}

function parseExpiresDays(value: string): number {
   return parseIntegerInRange(value, 1, 3650)
}

function parseIntegerInRange(value: string, minimum: number, maximum: number): number {
   const parsed = Number(value)
   if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new InvalidArgumentError(`expected an integer from ${minimum} to ${maximum}`)
   }
   return parsed
}
