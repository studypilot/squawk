import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema"

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export interface DatabaseHandle {
   database: Database
   close: () => Promise<void>
}

/** Connects to Postgres and applies all pending migrations before returning. */
export async function createPostgresDatabase(
   url: string,
   migrationsFolder: string
): Promise<DatabaseHandle> {
   const client = postgres(url, { max: 10, onnotice: () => {} })
   const database = drizzle(client, { schema })
   await migrate(database, { migrationsFolder })
   return { database, close: () => client.end({ timeout: 5 }) }
}
