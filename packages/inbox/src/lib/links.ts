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

export type TextSegment =
   { kind: "text"; text: string } | { kind: "link"; text: string; href: string }

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/** Splits plain text into text and link segments. Trailing punctuation stays outside links. */
export function splitTextIntoLinks(text: string): TextSegment[] {
   const segments: TextSegment[] = []
   let textStart = 0
   for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(TRAILING_PUNCTUATION, "")
      if (!isSafeHttpUrl(url)) {
         continue
      }
      if (match.index > textStart) {
         segments.push({ kind: "text", text: text.slice(textStart, match.index) })
      }
      segments.push({ kind: "link", text: url, href: url })
      textStart = match.index + url.length
   }
   if (textStart < text.length) {
      segments.push({ kind: "text", text: text.slice(textStart) })
   }
   return segments
}

/** Paragraphs are separated by blank lines; single line breaks stay inside a paragraph. */
export function splitParagraphs(text: string): string[] {
   return text
      .split(/\n[ \t]*\n/)
      .map(paragraph => paragraph.replace(/^\n+|\n+$/g, ""))
      .filter(paragraph => paragraph.trim() !== "")
}
