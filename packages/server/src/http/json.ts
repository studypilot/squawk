import type { Context } from "hono"
import { validationError } from "./errors"

/** Reads a JSON request body; malformed JSON becomes a 400 instead of a 500. */
export async function readJsonBody(c: Context): Promise<unknown> {
   try {
      return await c.req.json()
   } catch {
      throw validationError("Request body must be valid JSON")
   }
}
