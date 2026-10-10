import { access, constants } from "node:fs/promises"
import { sql } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { LIMITS } from "@squawk/shared"
import { meRoutes } from "./api/me"
import { screenshotRoutes } from "./api/screenshots"
import { siteRoutes } from "./api/sites"
import { squawkRoutes } from "./api/squawks"
import { tokenRoutes } from "./api/tokens"
import { createDeviceRoutes } from "./auth/device"
import { createOidcRoutes } from "./auth/oidc"
import type { AppDependencies, AppEnv } from "./context"
import { ApiError, errorBody } from "./http/errors"
import { describeError } from "./logger"
import { serveStatic } from "./static"

const JSON_BODY_LIMIT_BYTES = 256 * 1024
/** Screenshot plus the JSON part and multipart framing. */
const UPLOAD_BODY_LIMIT_BYTES = LIMITS.screenshotMaxBytes + 512 * 1024

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
   const app = new Hono<AppEnv>()
   const { logger } = dependencies

   app.use(async (c, next) => {
      const startedAt = performance.now()
      c.set("dependencies", dependencies)
      await next()
      logger.info("request", {
         method: c.req.method,
         path: c.req.path,
         status: c.res.status,
         ms: Math.round(performance.now() - startedAt)
      })
   })

   app.use(
      "/api/*",
      cors({
         origin: origin => origin || null,
         allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
         allowHeaders: ["Authorization", "Content-Type"],
         maxAge: 3600,
         credentials: false
      })
   )

   const rejectLargeBody = (): never => {
      throw new ApiError(413, "payload_too_large", "Request body is too large")
   }
   const jsonBodyLimit = bodyLimit({ maxSize: JSON_BODY_LIMIT_BYTES, onError: rejectLargeBody })
   const uploadBodyLimit = bodyLimit({ maxSize: UPLOAD_BODY_LIMIT_BYTES, onError: rejectLargeBody })
   app.use("/api/*", (c, next) => {
      const isUpload = c.req.method === "POST" && c.req.path === "/api/squawks"
      return isUpload ? uploadBodyLimit(c, next) : jsonBodyLimit(c, next)
   })

   app.route("/api/auth/device", createDeviceRoutes())
   app.route("/api/me", meRoutes)
   app.route("/api/sites", siteRoutes)
   app.route("/api/squawks", squawkRoutes)
   app.route("/api/screenshots", screenshotRoutes)
   app.route("/api/tokens", tokenRoutes)
   app.all("/api/*", c => c.json(errorBody("not_found", "No such API route"), 404))

   app.route("/auth", createOidcRoutes())
   app.all("/auth/*", c => c.text("Not found", 404))

   app.get("/healthz", async c => {
      try {
         await dependencies.database.execute(sql`select 1`)
         await access(dependencies.config.dataDir, constants.W_OK)
         return c.json({ ok: true })
      } catch (error) {
         logger.error("health check failed", describeError(error))
         return c.json({ ok: false }, 503)
      }
   })

   app.on(["GET", "HEAD"], "*", c => serveStatic(c, dependencies.publicDir))

   app.notFound(c => c.text("Not found", 404))
   app.onError((error, c) => handleError(error, c, dependencies))
   return app
}

function handleError(error: Error, c: Context, dependencies: AppDependencies): Response {
   if (error instanceof ApiError) {
      return c.json(errorBody(error.code, error.message), error.status)
   }
   if (error instanceof HTTPException && error.status < 500) {
      return c.json(errorBody("validation", error.message || "Bad request"), error.status)
   }
   dependencies.logger.error("unhandled error", {
      method: c.req.method,
      path: c.req.path,
      ...describeError(error)
   })
   return c.json(errorBody("internal", "Internal server error"), 500)
}
