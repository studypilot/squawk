import type { Author } from "@squawk/shared"
import { hueForName, initialsForName } from "../lib/avatar"
import { TerminalIcon } from "./icons"

export type AvatarSize = 20 | 24 | 32

/** Initials on a hue derived from the name; agents show a terminal glyph instead. */
export function Avatar({ author, size = 20 }: { author: Author; size?: AvatarSize }) {
   const name = author.kind === "agent" ? author.name : (author.name ?? author.email)
   const style = { width: size, height: size, fontSize: size <= 20 ? 9 : size <= 24 ? 10 : 12 }

   if (author.kind === "agent") {
      return (
         <span className="avatar avatar-agent" style={style} aria-hidden="true">
            <TerminalIcon size={size <= 20 ? 11 : 13} />
         </span>
      )
   }
   if (author.avatarUrl !== null) {
      return (
         <img
            className="avatar"
            style={style}
            src={author.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
         />
      )
   }
   return (
      <span
         className="avatar"
         style={{ ...style, background: `hsl(${hueForName(name)} 55% 45%)` }}
         aria-hidden="true"
      >
         {initialsForName(name)}
      </span>
   )
}
