import type { Author as AuthorValue } from "@squawk/shared"

export function Author({
   author,
   showAvatar = false
}: {
   author: AuthorValue
   showAvatar?: boolean
}) {
   if (author.kind === "agent") {
      return (
         <span className="author">
            <span className="author-name">{author.name}</span>
            <span className="agent-label">agent</span>
         </span>
      )
   }
   return (
      <span className="author" title={author.email}>
         {showAvatar && author.avatarUrl !== null && (
            <img className="avatar" src={author.avatarUrl} alt="" referrerPolicy="no-referrer" />
         )}
         <span className="author-name">{author.name ?? author.email}</span>
      </span>
   )
}
