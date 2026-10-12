import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url))

async function runMigration(client: PGlite, tag: string): Promise<void> {
   const text = await readFile(`${migrationsFolder}/${tag}.sql`, "utf8")
   for (const statement of text.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.exec(statement)
   }
}

describe("migration 0002_read_state_and_work_claims", () => {
   let client: PGlite

   beforeAll(async () => {
      client = new PGlite()
      await runMigration(client, "0000_initial")
      await runMigration(client, "0001_agent_authorship_and_drafts")
   })

   afterAll(() => client.close())

   it("marks existing squawks read up to each user's own newest comment", async () => {
      await client.exec(`
         insert into users (id, email) values
            ('00000000-0000-4000-8000-00000000000a', 'ada@example.com'),
            ('00000000-0000-4000-8000-00000000000b', 'bob@example.com');
         insert into sites (id, key) values ('00000000-0000-4000-8000-000000000001', 'site');
         insert into tokens (id, name, kind, client, prefix, hash, created_by_user_id) values
            ('00000000-0000-4000-8000-0000000000c1', 'CLI laptop', 'login', 'cli', 'sqk_x', 'h',
             '00000000-0000-4000-8000-00000000000a');
         insert into squawks (id, site_id, page, number, status, meta, author_user_id, created_at,
               submitted_at) values
            ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '/',
             1, 'open', '{}', '00000000-0000-4000-8000-00000000000a', '2026-10-01T10:00:00Z',
             '2026-10-01T10:00:00Z'),
            ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '/',
             2, 'draft', '{}', '00000000-0000-4000-8000-00000000000a', '2026-10-01T10:00:00Z',
             null);
         insert into comments (squawk_id, body, author_user_id, author_token_id, created_at) values
            ('00000000-0000-4000-8000-000000000101', 'Body', '00000000-0000-4000-8000-00000000000a',
             null, '2026-10-01T10:00:00Z'),
            ('00000000-0000-4000-8000-000000000101', 'Bob', '00000000-0000-4000-8000-00000000000b',
             null, '2026-10-01T11:00:00Z'),
            ('00000000-0000-4000-8000-000000000101', 'Agent', '00000000-0000-4000-8000-00000000000a',
             '00000000-0000-4000-8000-0000000000c1', '2026-10-01T12:00:00Z'),
            ('00000000-0000-4000-8000-000000000102', 'Draft', '00000000-0000-4000-8000-00000000000a',
             null, '2026-10-01T10:00:00Z');
      `)

      await runMigration(client, "0002_read_state_and_work_claims")

      const { rows } = await client.query<{ squawk_id: string; user_id: string; read_at: Date }>(
         "select squawk_id, user_id, read_at from squawk_reads order by user_id"
      )
      expect(rows).toEqual([
         {
            squawk_id: "00000000-0000-4000-8000-000000000101",
            user_id: "00000000-0000-4000-8000-00000000000a",
            read_at: new Date("2026-10-01T10:00:00Z")
         },
         {
            squawk_id: "00000000-0000-4000-8000-000000000101",
            user_id: "00000000-0000-4000-8000-00000000000b",
            read_at: new Date("2026-10-01T11:00:00Z")
         }
      ])
   })

   it("allows a claim only with a claimant and a start time", async () => {
      const claim = (columns: string) =>
         client.exec(
            `update squawks set ${columns} where id = '00000000-0000-4000-8000-000000000101'`
         )
      await expect(claim("working_since = now()")).rejects.toThrow(/squawks_working_claimant/)
      await expect(
         claim("working_token_id = '00000000-0000-4000-8000-0000000000c1'")
      ).rejects.toThrow(/squawks_working_claimant/)
      await claim(
         "working_token_id = '00000000-0000-4000-8000-0000000000c1', working_since = now()"
      )
   })
})
