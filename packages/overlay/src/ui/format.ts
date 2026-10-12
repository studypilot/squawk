import type { Author } from "@squawk/shared"

export function authorName(author: Author): string {
   if (author.kind === "agent") return `${author.name} (agent)`
   return author.name || author.email
}

export function relativeTime(isoDate: string, now: number = Date.now()): string {
   const seconds = Math.round((now - new Date(isoDate).getTime()) / 1000)
   if (seconds < 45) return "just now"
   const minutes = Math.round(seconds / 60)
   if (minutes < 60) return `${minutes}m ago`
   const hours = Math.round(minutes / 60)
   if (hours < 24) return `${hours}h ago`
   const days = Math.round(hours / 24)
   if (days < 30) return `${days}d ago`
   return new Date(isoDate).toLocaleDateString()
}
