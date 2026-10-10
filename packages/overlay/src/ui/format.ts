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

export function firstLine(text: string): string {
   return (
      text
         .split("\n")
         .find(line => line.trim())
         ?.trim() ?? ""
   )
}

const TOKEN_PATTERN = /(`[^`\n]+`)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g

/** Plain text with `code` spans and links recognised; everything else stays text. */
export function renderBody(text: string): DocumentFragment {
   const fragment = document.createDocumentFragment()
   let position = 0
   for (const match of text.matchAll(TOKEN_PATTERN)) {
      const index = match.index
      fragment.append(text.slice(position, index))
      const [token, code] = match
      if (code) {
         const element = document.createElement("code")
         element.textContent = code.slice(1, -1)
         fragment.append(element)
      } else {
         const link = document.createElement("a")
         link.href = token
         link.textContent = token
         link.target = "_blank"
         link.rel = "noopener noreferrer"
         fragment.append(link)
      }
      position = index + token.length
   }
   fragment.append(text.slice(position))
   return fragment
}
