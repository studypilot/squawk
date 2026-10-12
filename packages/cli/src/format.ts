import type { Author } from "@squawk/shared"

const ELLIPSIS = "…"

export function truncate(text: string, maxLength: number): string {
   if (text.length <= maxLength) return text
   return `${text.slice(0, Math.max(maxLength - 1, 0))}${ELLIPSIS}`
}

/** First non-empty line, for one-line previews of multi-line bodies. */
export function firstLine(text: string): string {
   return (
      text
         .split("\n")
         .map(line => line.trim())
         .find(line => line !== "") ?? ""
   )
}

/** `just now`, `5m ago`, `3h ago`, `12d ago`, or the date for anything older than 30 days. */
export function relativeTime(isoDate: string, now: Date): string {
   const date = new Date(isoDate)
   const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
   if (seconds < 60) return "just now"
   const minutes = Math.floor(seconds / 60)
   if (minutes < 60) return `${minutes}m ago`
   const hours = Math.floor(minutes / 60)
   if (hours < 24) return `${hours}h ago`
   const days = Math.floor(hours / 24)
   if (days <= 30) return `${days}d ago`
   return date.toISOString().slice(0, 10)
}

/** Left-aligned columns separated by two spaces, without trailing whitespace. */
export function renderTable(headers: string[], rows: string[][]): string {
   const widths = headers.map((header, column) =>
      Math.max(header.length, ...rows.map(row => (row[column] ?? "").length))
   )
   const renderRow = (cells: string[]): string =>
      cells
         .map((cell, column) => cell.padEnd(widths[column] ?? 0))
         .join("  ")
         .trimEnd()
   return [renderRow(headers), ...rows.map(renderRow)].join("\n")
}

/** `Jan`, `Agent for Jan` (Jan's CLI wrote it), or `Claude (agent)` for an agent token. */
export function authorLabel(author: Author): string {
   if (author.kind === "agent") return `${author.name} (agent)`
   if (author.agent !== null) return `Agent for ${firstName(author.name) ?? author.email}`
   return author.name ?? author.email
}

function firstName(name: string | null): string | undefined {
   return name?.trim().split(/\s+/)[0] || undefined
}

/** Lower-case file-name-safe version of a site key: `feat/Login` becomes `feat-login`. */
export function siteSlug(siteKey: string): string {
   return siteKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
}

/** Shell-safe form of a `<site>#<n>` reference for hints the user may copy. */
export function displayRef(siteKey: string, number: number): string {
   return `'${siteKey}#${number}'`
}
