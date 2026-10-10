import { eq } from "drizzle-orm"
import type { Database } from "../db/index"
import { users, type UserRow } from "../db/schema"

interface UserProfile {
   email: string
   name?: string | null
   avatarUrl?: string | null
}

/** Creates the user or refreshes name and picture from the identity provider. */
export async function recordLogin(database: Database, profile: UserProfile): Promise<UserRow> {
   const values = {
      email: profile.email.toLowerCase(),
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      lastLoginAt: new Date()
   }
   const [user] = await database
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
         target: users.email,
         set: { name: values.name, avatarUrl: values.avatarUrl, lastLoginAt: values.lastLoginAt }
      })
      .returning()
   if (!user) throw new Error("User upsert returned no row")
   return user
}

/** Finds or creates a user by email without touching an existing profile. */
export async function ensureUser(database: Database, email: string): Promise<UserRow> {
   const normalizedEmail = email.toLowerCase()
   await database.insert(users).values({ email: normalizedEmail }).onConflictDoNothing()
   const [user] = await database.select().from(users).where(eq(users.email, normalizedEmail))
   if (!user) throw new Error("User insert returned no row")
   return user
}

export async function findUserById(database: Database, id: string): Promise<UserRow | null> {
   const [user] = await database.select().from(users).where(eq(users.id, id))
   return user ?? null
}
