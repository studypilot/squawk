import type { ReactNode } from "react"
import { copyToClipboard } from "../lib/clipboard"
import { CopyIcon } from "./icons"
import { useToast } from "./toast"

/** Copies `text` and confirms with a toast. Renders `children` (default: icon + "Copy"). */
export function CopyButton({
   text,
   label = "Copy",
   confirmation = "Copied",
   className = "button button-secondary button-small",
   children
}: {
   text: string
   label?: string
   confirmation?: string
   className?: string
   children?: ReactNode
}) {
   const showToast = useToast()

   async function copy() {
      const copied = await copyToClipboard(text)
      showToast(copied ? confirmation : "Copying failed, select the text instead")
   }

   return (
      <button type="button" className={className} aria-label={label} onClick={() => void copy()}>
         {children ?? (
            <>
               <CopyIcon size={14} />
               <span>{label}</span>
            </>
         )}
      </button>
   )
}
