import { SQUAWK_LINK_FRAGMENT_KEY } from "@squawk/shared"

/**
 * The page URL with `squawk=<id>` added to the fragment, so the overlay opens the thread.
 * An existing fragment is kept (`#/route&squawk=<id>`); a stale `squawk=` entry is replaced.
 */
export function buildSquawkPageUrl(pageUrl: string, squawkId: string): string {
   const entry = `${SQUAWK_LINK_FRAGMENT_KEY}=${encodeURIComponent(squawkId)}`
   const hashIndex = pageUrl.indexOf("#")
   if (hashIndex === -1) {
      return `${pageUrl}#${entry}`
   }
   const base = pageUrl.slice(0, hashIndex)
   const keptParts = pageUrl
      .slice(hashIndex + 1)
      .split("&")
      .filter(part => part !== "" && !part.startsWith(`${SQUAWK_LINK_FRAGMENT_KEY}=`))
   return `${base}#${[...keptParts, entry].join("&")}`
}

/** Only http and https URLs may become links; everything else is shown as text. */
export function isSafeHttpUrl(value: string): boolean {
   try {
      const url = new URL(value)
      return url.protocol === "http:" || url.protocol === "https:"
   } catch {
      return false
   }
}

export function siteLink(siteKey: string): string {
   return `/sites/${encodeURIComponent(siteKey)}`
}

export function squawkLink(squawkId: string): string {
   return `/squawks/${encodeURIComponent(squawkId)}`
}
