import type { Author as AuthorValue } from "@squawk/shared"
import { Avatar } from "./avatar"
import type { AvatarSize } from "./avatar"

export function authorName(author: AuthorValue): string {
   return author.kind === "agent" ? author.name : (author.name ?? author.email)
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
      <span className="author" title={author.kind === "user" ? author.email : undefined}>
         {showAvatar && <Avatar author={author} size={avatarSize} />}
         <span className="author-name">{authorName(author)}</span>
         {author.kind === "agent" && <span className="chip chip-agent">agent</span>}
      </span>
   )
}
