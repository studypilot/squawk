/** Clipboard API where allowed, otherwise the legacy copy command (plain-http preview hosts). */
export async function copyText(text: string, root: ParentNode): Promise<boolean> {
   try {
      await navigator.clipboard.writeText(text)
      return true
   } catch {
      const field = document.createElement("textarea")
      field.value = text
      field.style.cssText = "position:fixed;opacity:0;pointer-events:none"
      root.append(field)
      field.select()
      const copied = document.execCommand("copy")
      field.remove()
      return copied
   }
}
