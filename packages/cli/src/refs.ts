import { siteKeySchema } from "@squawk/shared"
import { CliError } from "./errors"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMBER_PATTERN = /^#?(\d+)$/

/**
 * Turns a user-supplied squawk reference into the `:ref` path segment of the API.
 *
 * Accepted forms: a uuid, `<site>#<n>`, or `#<n>` / `<n>` together with `site`. The result is
 * URL-encoded, so `my-site#12` becomes `my-site%2312`.
 */
export function resolveRef(ref: string, site?: string): string {
   const trimmed = ref.trim()
   if (UUID_PATTERN.test(trimmed)) return trimmed.toLowerCase()

   const numberOnly = NUMBER_PATTERN.exec(trimmed)
   if (numberOnly) {
      if (site === undefined) {
         throw new CliError(`"${trimmed}" needs --site, or write it as <site>#<number>.`)
      }
      return encodeSiteRef(site, numberOnly[1] ?? "")
   }

   const separator = trimmed.lastIndexOf("#")
   if (separator > 0) {
      return encodeSiteRef(trimmed.slice(0, separator), trimmed.slice(separator + 1))
   }
   throw new CliError(
      `Invalid squawk reference "${ref}". Use a uuid, <site>#<number>, or #<number> with --site.`
   )
}

function encodeSiteRef(site: string, number: string): string {
   if (!siteKeySchema.safeParse(site).success) throw new CliError(`Invalid site key "${site}".`)
   if (!/^\d+$/.test(number) || Number(number) < 1) {
      throw new CliError(`Invalid squawk number "${number}".`)
   }
   return encodeURIComponent(`${site}#${Number(number)}`)
}
