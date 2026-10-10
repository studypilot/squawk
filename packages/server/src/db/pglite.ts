import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { DatabaseHandle } from "./index"
import * as schema from "./schema"

/** In-memory Postgres for tests, migrated with the same files as production. Test-only. */
export async function createPgliteDatabase(migrationsFolder: string): Promise<DatabaseHandle> {
   const client = new PGlite()
   const database = drizzle(client, { schema })
   await migrate(database, { migrationsFolder })
   return { database, close: () => client.close() }
}
