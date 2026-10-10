import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { CliError } from "./errors"

export type Environment = Record<string, string | undefined>

const storedConfigSchema = z.object({
   server: z.string().optional(),
   token: z.string().optional()
})
export type StoredConfig = z.infer<typeof storedConfigSchema>

export interface Connection {
   server: string | null
   token: string | null
}

export function configPath(environment: Environment): string {
   const base = nonEmpty(environment.XDG_CONFIG_HOME) ?? join(homedir(), ".config")
   return join(base, "squawk", "config.json")
}

export async function readConfig(environment: Environment): Promise<StoredConfig> {
   const path = configPath(environment)
   let text: string
   try {
      text = await readFile(path, "utf8")
   } catch (error) {
      if (isMissingFile(error)) return {}
      throw new CliError(`Could not read ${path}: ${String(error)}`)
   }
   let json: unknown
   try {
      json = JSON.parse(text)
   } catch {
      throw new CliError(`${path} is not valid JSON.`)
   }
   const result = storedConfigSchema.safeParse(json)
   if (!result.success) throw new CliError(`${path} is not a valid squawk config.`)
   return result.data
}

/** Writes the config readable only by the current user, because it contains a token. */
export async function writeConfig(environment: Environment, config: StoredConfig): Promise<void> {
   const path = configPath(environment)
   await mkdir(dirname(path), { recursive: true, mode: 0o700 })
   await writeFile(path, `${JSON.stringify(config, null, 3)}\n`, { mode: 0o600 })
   // `mode` only applies when the file is created; tighten an existing file as well.
   await chmod(path, 0o600)
}

/** Accepts `host`, `https://host` or `https://host/prefix/` and returns `https://host/prefix`. */
export function normalizeServer(value: string): string {
   const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
   let url: URL
   try {
      url = new URL(withScheme)
   } catch {
      throw new CliError(`Invalid server URL: ${value}`)
   }
   if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new CliError(`Server URL must use http or https: ${value}`)
   }
   return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
}

/**
 * Server: `--server`, then `SQUAWK_SERVER`, then the config file.
 * Token: `SQUAWK_TOKEN`, then the config file. A stored token is only used for the server it was
 * issued by, so pointing `--server` elsewhere never leaks it.
 */
export async function resolveConnection(
   environment: Environment,
   serverFlag: string | undefined
): Promise<Connection> {
   const stored = await readConfig(environment)
   const serverSource =
      nonEmpty(serverFlag) ?? nonEmpty(environment.SQUAWK_SERVER) ?? nonEmpty(stored.server)
   const server = serverSource === undefined ? null : normalizeServer(serverSource)
   const storedServer = stored.server === undefined ? null : normalizeServer(stored.server)
   const storedToken =
      server !== null && server === storedServer ? nonEmpty(stored.token) : undefined
   const token = nonEmpty(environment.SQUAWK_TOKEN) ?? storedToken ?? null
   return { server, token }
}

function nonEmpty(value: string | undefined): string | undefined {
   const trimmed = value?.trim()
   return trimmed === "" ? undefined : trimmed
}

function isMissingFile(error: unknown): boolean {
   return error instanceof Error && "code" in error && error.code === "ENOENT"
}
