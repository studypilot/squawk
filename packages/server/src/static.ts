import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { Context } from "hono"

const contentTypes: Record<string, string> = {
   ".html": "text/html; charset=utf-8",
   ".js": "text/javascript; charset=utf-8",
   ".mjs": "text/javascript; charset=utf-8",
   ".css": "text/css; charset=utf-8",
   ".json": "application/json",
   ".map": "application/json",
   ".svg": "image/svg+xml",
   ".png": "image/png",
   ".jpg": "image/jpeg",
   ".webp": "image/webp",
   ".ico": "image/x-icon",
   ".woff2": "font/woff2",
   ".txt": "text/plain; charset=utf-8"
}

/**
 * Serves the built inbox and overlay from `publicDir`: `/squawk.js` revalidates every 5 minutes,
 * hashed `/assets/*` are immutable, other files are served as is, and every other path falls
 * back to `index.html` so client-side routes work.
 */
export async function serveStatic(c: Context, publicDir: string): Promise<Response> {
   const requestPath = decodePath(c.req.path)
   if (requestPath === null) return c.text("Bad request", 400)
   const filePath = path.join(publicDir, requestPath)
   const isInsidePublicDir = filePath.startsWith(path.join(publicDir, path.sep))

   if (isInsidePublicDir && (await isFile(filePath))) {
      return sendFile(c, filePath, cacheControlFor(requestPath))
   }
   if (requestPath === "/squawk.js" || requestPath.startsWith("/assets/")) {
      return c.text("Not found", 404)
   }

   const indexPath = path.join(publicDir, "index.html")
   if (!(await isFile(indexPath))) return c.text("inbox not built", 503)
   return sendFile(c, indexPath, "no-cache")
}

function cacheControlFor(requestPath: string): string {
   if (requestPath.startsWith("/assets/")) return "public, max-age=31536000, immutable"
   if (requestPath === "/index.html") return "no-cache"
   return "public, max-age=300"
}

async function sendFile(c: Context, filePath: string, cacheControl: string): Promise<Response> {
   const fileStats = await stat(filePath)
   const etag = `W/"${fileStats.size.toString(16)}-${Math.floor(fileStats.mtimeMs).toString(16)}"`
   const headers: Record<string, string> = { ETag: etag, "Cache-Control": cacheControl }
   // The overlay loads Inter from here into whatever origin hosts the preview; fonts are
   // fetched in CORS mode by browsers, so without this header every foreign page falls back.
   if (filePath.includes(`${path.sep}fonts${path.sep}`))
      headers["Access-Control-Allow-Origin"] = "*"
   if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers)

   const contentType = contentTypes[path.extname(filePath).toLowerCase()]
   return c.body(await readFile(filePath), 200, {
      ...headers,
      "Content-Type": contentType ?? "application/octet-stream"
   })
}

function decodePath(encodedPath: string): string | null {
   try {
      return decodeURIComponent(encodedPath)
   } catch {
      return null
   }
}

async function isFile(filePath: string): Promise<boolean> {
   const fileStats = await stat(filePath).catch(() => null)
   return fileStats?.isFile() ?? false
}
