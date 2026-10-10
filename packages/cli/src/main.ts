import { spawn } from "node:child_process"
import { hostname } from "node:os"
import { text } from "node:stream/consumers"
import { runCli } from "./program"

process.exitCode = await runCli(process.argv.slice(2), {
   environment: process.env,
   cwd: process.cwd(),
   hostname: hostname(),
   stdout: output => process.stdout.write(output),
   stderr: output => process.stderr.write(output),
   readStdin: () => text(process.stdin),
   openUrl,
   now: () => new Date()
})

/** Opens a URL in the default browser; failures are ignored because the URL is printed anyway. */
function openUrl(url: string): void {
   if (!/^https?:\/\//.test(url)) return
   const [command, commandArguments] = openerFor(url)
   try {
      const child = spawn(command, commandArguments, { stdio: "ignore", detached: true })
      child.on("error", () => {})
      child.unref()
   } catch {
      // No opener available; the user follows the printed link.
   }
}

function openerFor(url: string): [string, string[]] {
   if (process.platform === "darwin") return ["open", [url]]
   if (process.platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]]
   return ["xdg-open", [url]]
}
