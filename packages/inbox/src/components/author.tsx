import type { Author as AuthorValue } from "@squawk/shared"
import { Avatar } from "./avatar"
import type { AvatarSize } from "./avatar"

/**
 * Display name. Something an agent wrote through the user's CLI login reads "Agent · for Ada", so
 * the user's own name only ever stands for what they wrote themselves.
 */
export function authorName(author: AuthorValue): string {
   if (author.kind === "agent") return author.name
   if (author.agent !== null) return `Agent · for ${firstName(author)}`
   return author.name ?? author.email
}

/** Hover text: the email for people, the CLI token and its owner for delegated agents. */
export function authorTitle(author: AuthorValue): string | undefined {
   if (author.kind === "agent") return undefined
   if (author.agent !== null) return `${author.agent.name} on behalf of ${author.email}`
   return author.email
}

function firstName(author: Extract<AuthorValue, { kind: "user" }>): string {
   return author.name?.trim().split(/\s+/)[0] || author.email
}

export function Author({
   author,
   showAvatar = false,
   avatarSize = 20
}: {
   author: AuthorValue
   showAvatar?: boolean
   avatarSize?: AvatarSize
}) {
   return (
      <span className="author" title={authorTitle(author)}>
         {showAvatar && <Avatar author={author} size={avatarSize} />}
         <span className="author-name">{authorName(author)}</span>
         {author.kind === "agent" && <span className="chip chip-agent">agent</span>}
      </span>
   )
}
