import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { type CommandContext, printJson, printLine } from "../context"
import { CliError } from "../errors"

const runFile = promisify(execFile)

/**
 * Suggests a site key from the current git branch. Characters a site key cannot contain become
 * `-`, so `feat/login+2fa` turns into `feat/login-2fa`.
 */
export async function siteKeyCommand(context: CommandContext): Promise<void> {
   const siteKey = await currentBranchSiteKey(context.cwd)
   if (context.json) return printJson(context, { siteKey })
   printLine(context, siteKey)
}

/** The site key of the git branch checked out in `cwd`. */
export async function currentBranchSiteKey(cwd: string): Promise<string> {
   let branch: string
   try {
      const { stdout } = await runFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
      branch = stdout.trim()
   } catch {
      throw new CliError("Not inside a git repository; pass the site key explicitly (--site).")
   }
   if (branch === "" || branch === "HEAD") {
      throw new CliError("Detached HEAD has no branch name; pass the site key explicitly (--site).")
   }
   return siteKeyFromBranch(branch)
}

export function siteKeyFromBranch(branch: string): string {
   return branch.replace(/[^A-Za-z0-9._:/@-]/g, "-")
}
