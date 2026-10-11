/** Writes to the clipboard and reports whether it worked, so callers can show a toast. */
export async function copyToClipboard(text: string): Promise<boolean> {
   try {
      await navigator.clipboard.writeText(text)
      return true
   } catch {
      return false
   }
}
