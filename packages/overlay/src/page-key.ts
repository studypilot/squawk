import { LIMITS, SQUAWK_LINK_FRAGMENT_KEY } from "@squawk/shared"

const LOCATION_CHANGE_EVENT = "squawk:locationchange"

const linkPattern = new RegExp(`(?:^|[#&?])${SQUAWK_LINK_FRAGMENT_KEY}=([0-9a-f-]{36})`, "i")
const linkWithSeparatorPattern = new RegExp(
   `([#&?])${SQUAWK_LINK_FRAGMENT_KEY}=[0-9a-f-]{36}(&?)`,
   "i"
)

export interface LocationParts {
   pathname: string
   search: string
   hash: string
}

/** Squawk id from a `squawk=<uuid>` entry anywhere in the hash, or null. */
export function extractSquawkLinkId(hash: string): string | null {
   const match = linkPattern.exec(hash)
   return match?.[1]?.toLowerCase() ?? null
}

/**
 * Removes the `squawk=<uuid>` entry from a hash and keeps everything else untouched, so hashes
 * used for app routing (`#path?{json}`) survive.
 */
export function stripSquawkLink(hash: string): string {
   const stripped = hash.replace(
      linkWithSeparatorPattern,
      (_match, separator: string, trailingAmpersand: string) => {
         if (separator === "&") return trailingAmpersand
         if (trailingAmpersand) return separator
         return separator === "#" ? "#" : ""
      }
   )
   return stripped === "#" ? "" : stripped
}

function splitHref(href: string): { base: string; hash: string } {
   const hashIndex = href.indexOf("#")
   if (hashIndex === -1) return { base: href, hash: "" }
   return { base: href.slice(0, hashIndex), hash: href.slice(hashIndex) }
}

/** `href` without the squawk deep-link entry in its hash. */
export function stripSquawkLinkFromHref(href: string): string {
   const { base, hash } = splitHref(href)
   return base + stripSquawkLink(hash)
}

/** `href` with `squawk=<id>` appended to its hash, replacing an existing squawk entry. */
export function buildSquawkLink(href: string, squawkId: string): string {
   const { base, hash } = splitHref(href)
   const rest = stripSquawkLink(hash)
   const entry = `${SQUAWK_LINK_FRAGMENT_KEY}=${squawkId}`
   return rest ? `${base}${rest}&${entry}` : `${base}#${entry}`
}

/** Default page key: path, query and hash, without the squawk deep-link entry. */
export function derivePageKey(location: LocationParts): string {
   const key = location.pathname + location.search + stripSquawkLink(location.hash)
   return (key || "/").slice(0, LIMITS.pageKeyMaxLength)
}

/** Site key from a hostname, reduced to the characters the server accepts. */
export function defaultSiteKey(hostname: string): string {
   const key = hostname.replace(/[^A-Za-z0-9._:/@-]/g, "-").slice(0, LIMITS.siteKeyMaxLength)
   return key || "localhost"
}

/**
 * Calls `onChange` after every client-side navigation: history.pushState/replaceState (patched
 * to dispatch an event), popstate and hashchange. Returns a function that stops listening; the
 * history patch stays because other code may have wrapped it in the meantime.
 */
export function watchLocation(onChange: () => void): () => void {
   patchHistory()
   const events = [LOCATION_CHANGE_EVENT, "popstate", "hashchange"]
   for (const name of events) window.addEventListener(name, onChange)
   return () => {
      for (const name of events) window.removeEventListener(name, onChange)
   }
}

let historyPatched = false

function patchHistory(): void {
   if (historyPatched) return
   historyPatched = true
   for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method]
      history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
         original.apply(this, args)
         window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT))
      }
   }
}
