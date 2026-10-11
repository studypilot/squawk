/** Deterministic hue for an author name, so the same person always gets the same colour. */
export function hueForName(name: string): number {
   let hash = 0
   for (const character of name) {
      hash = (hash * 31 + character.codePointAt(0)!) >>> 0
   }
   return hash % 360
}

/** One or two initials: "Ada Lovelace" → "AL", "ada@example.com" → "A". */
export function initialsForName(name: string): string {
   const words = name
      .replace(/@.*$/, "")
      .split(/[\s._-]+/)
      .filter(word => word !== "")
   if (words.length === 0) {
      return "?"
   }
   const first = words[0]!.charAt(0)
   const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : ""
   return `${first}${last}`.toUpperCase()
}
