import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { createApp } from "./app"
import { loadConfig } from "./config"
import { createPostgresDatabase } from "./db/index"
import { createLogger, describeError } from "./logger"

/** `src/main.ts` in development and `dist/main.js` in the image both sit one level below the package root. */
const packageRoot = fileURLToPath(new URL("..", import.meta.url))

async function main(): Promise<void> {
   const config = loadConfig(process.env)
   const logger = createLogger(config.logLevel)
   if (config.devUserEmail) {
      logger.warn("development user enabled, requests without credentials act as this user", {
         email: config.devUserEmail
      })
   }
   if (!config.oidc) logger.warn("OIDC is not configured, browser sign-in is disabled")

   await mkdir(path.join(config.dataDir, "screenshots"), { recursive: true })
   const { database, close } = await createPostgresDatabase(
      config.databaseUrl,
      path.join(packageRoot, "drizzle")
   )
   logger.info("database migrated")

   const app = createApp({
      config,
      database,
      logger,
      publicDir: path.join(packageRoot, "public")
   })
   const server = serve({ fetch: app.fetch, port: config.port }, info => {
      logger.info("listening", { port: info.port, publicUrl: config.publicUrl })
   })

   const shutdown = (signal: string): void => {
      logger.info("shutting down", { signal })
      server.close(() => {
         close().finally(() => process.exit(0))
      })
      setTimeout(() => process.exit(1), 10_000).unref()
   }
   process.once("SIGTERM", () => shutdown("SIGTERM"))
   process.once("SIGINT", () => shutdown("SIGINT"))
}

main().catch(error => {
   process.stderr.write(`squawk-server failed to start: ${describeError(error).error}\n`)
   process.exit(1)
})
