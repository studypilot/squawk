import type { ErrorCode, ErrorResponse } from "@squawk/shared"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

/** An expected failure that maps directly to an `{ error: { code, message } }` response. */
export class ApiError extends Error {
   constructor(
      readonly status: ContentfulStatusCode,
      readonly code: ErrorCode,
      message: string
   ) {
      super(message)
   }
}

export function notFound(message = "Not found"): ApiError {
   return new ApiError(404, "not_found", message)
}

export function forbidden(message: string): ApiError {
   return new ApiError(403, "forbidden", message)
}

export function validationError(message: string): ApiError {
   return new ApiError(400, "validation", message)
}

export function errorBody(code: ErrorCode, message: string): ErrorResponse {
   return { error: { code, message } }
}

/** Parses input with a shared schema; failures become 400 `validation` with a readable message. */
export function parseInput<Schema extends z.ZodType>(
   schema: Schema,
   input: unknown
): z.output<Schema> {
   const result = schema.safeParse(input)
   if (!result.success) throw validationError(z.prettifyError(result.error))
   return result.data
}
