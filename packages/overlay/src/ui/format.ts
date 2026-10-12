import type { Author } from "@squawk/shared"

/** First word of the name, otherwise the local part of the email. */
export function firstName(author: { name: string | null; email: string }): string {
   const first = author.name?.trim().split(/\s+/)[0]
   return first || author.email.split("@")[0] || author.email
}

/** True for agent tokens and for agents writing on a user's behalf through the CLI. */
export function isAgent(author: Author): boolean {
   return author.kind === "agent" || author.agent !== null
}

/**
 * Display name. An agent writing on a user's behalf is never shown under the user's name, so
 * nobody mistakes an agent's reply for the person's own.
 */
export function authorName(author: Author): string {
   if (author.kind === "agent") return `Agent · ${author.name}`
   if (author.agent) return `Agent · for ${firstName(author)}`
   return author.name || author.email
}

/** Tooltip next to the name: the agent's token label, or the user's email. */
export function authorTooltip(author: Author): string {
   if (author.kind === "agent") return author.name
   if (author.agent) return author.agent.name
   return author.email
}

/** Identity for de-duplicating avatars; an agent and its user are different people here. */
export function authorKey(author: Author): string {
   if (author.kind === "agent") return `agent:${author.id}`
   return author.agent ? `token:${author.agent.tokenId}` : `user:${author.id}`
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

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
   return `${count} ${count === 1 ? singular : pluralForm}`
}
