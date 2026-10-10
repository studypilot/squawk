import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { eq } from "drizzle-orm"
import { createApp } from "../app"
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/session"
import { insertToken } from "../auth/tokens"
import { ensureUser } from "../auth/users"
import type { Config } from "../config"
import type { Database } from "../db/index"
import { createPgliteDatabase } from "../db/pglite"
import { sites, type TokenRow, type UserRow } from "../db/schema"
import { createLogger } from "../logger"

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url))

export type Credentials = { cookie: string } | { bearer: string } | null

export interface TestContext {
   app: ReturnType<typeof createApp>
   database: Database
   config: Config
   dataDir: string
   publicDir: string
   /** Creates the user if needed and returns a valid session cookie header value. */
   signIn: (email: string) => Promise<{ user: UserRow; cookie: string }>
   createToken: (options: {
      kind: TokenRow["kind"]
      createdBy: UserRow
      name?: string
      siteKey?: string
   }) => Promise<{ token: TokenRow; secret: string }>
   request: (
      method: string,
      requestPath: string,
      options?: {
         credentials?: Credentials
         json?: unknown
         body?: RequestInit["body"]
         headers?: RequestInit["headers"]
      }
   ) => Promise<Response>
   close: () => Promise<void>
}

export async function createTestContext(overrides: Partial<Config> = {}): Promise<TestContext> {
   const handle = await createPgliteDatabase(migrationsFolder)
   const { database } = handle
   const dataDir = await mkdtemp(path.join(tmpdir(), "squawk-data-"))
   const publicDir = await mkdtemp(path.join(tmpdir(), "squawk-public-"))
   const config: Config = {
      databaseUrl: "pglite://memory",
      publicUrl: "http://squawk.test",
      sessionSecret: "test-secret-that-is-at-least-32-characters-long",
      oidc: null,
      dataDir,
      port: 0,
      logLevel: "silent",
      devUserEmail: null,
      ...overrides
   }
   const app = createApp({ config, database, logger: createLogger("silent"), publicDir })

   return {
      app,
      database,
      config,
      dataDir,
      publicDir,
      async signIn(email) {
         const user = await ensureUser(database, email)
         const token = await createSessionToken(config, user)
         return { user, cookie: `${SESSION_COOKIE_NAME}=${token}` }
      },
      async createToken({ kind, createdBy, name, siteKey }) {
         const siteId = siteKey ? await ensureSiteId(database, siteKey) : null
         return insertToken(database, {
            name: name ?? `${kind} token`,
            kind,
            siteId,
            createdBy,
            expiresAt: null
         })
      },
      request(method, requestPath, options = {}) {
         const headers = new Headers(options.headers)
         const credentials = options.credentials
         if (credentials && "cookie" in credentials) headers.set("Cookie", credentials.cookie)
         if (credentials && "bearer" in credentials) {
            headers.set("Authorization", `Bearer ${credentials.bearer}`)
         }
         let body = options.body
         if (options.json !== undefined) {
            headers.set("Content-Type", "application/json")
            body = JSON.stringify(options.json)
         }
         return Promise.resolve(app.request(requestPath, { method, headers, body }))
      },
      async close() {
         await handle.close()
         await rm(dataDir, { recursive: true, force: true })
         await rm(publicDir, { recursive: true, force: true })
      }
   }
}

async function ensureSiteId(database: Database, siteKey: string): Promise<string> {
   await database.insert(sites).values({ key: siteKey }).onConflictDoNothing()
   const [site] = await database.select().from(sites).where(eq(sites.key, siteKey))
   if (!site) throw new Error("Site was not created")
   return site.id
}

/** Smallest valid PNG: 1×1 transparent pixel. */
export const tinyPng = Buffer.from(
   "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
   "base64"
)

export const sampleAnchor = {
   version: 1,
   selectors: { testId: "save-button", css: "main > button", tagName: "button" },
   rect: { x: 0.5, y: 0.25 },
   page: { x: 100, y: 200, scrollX: 0, scrollY: 40 },
   elementBox: { x: 80, y: 150, width: 40, height: 20 },
   viewport: { width: 1440, height: 900 }
}

/** Builds the multipart body of `POST /api/squawks`. */
export function squawkForm(input: Record<string, unknown>, screenshot?: Buffer): FormData {
   const form = new FormData()
   form.append("squawk", JSON.stringify(input))
   if (screenshot) {
      form.append(
         "screenshot",
         new Blob([new Uint8Array(screenshot)], { type: "image/png" }),
         "shot.png"
      )
   }
   return form
}

export const screenshotMetadata = { width: 1, height: 1, devicePixelRatio: 2, source: "extension" }
