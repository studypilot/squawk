import { useEffect } from "react"
import type { ReactNode } from "react"
import { CloseIcon } from "./icons"

/** A full-screen view over a blurred backdrop. Escape, the backdrop and the close button dismiss it. */
export function Lightbox({ onClose, children }: { onClose: () => void; children: ReactNode }) {
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === "Escape") {
            onClose()
         }
      }
      document.addEventListener("keydown", onKeyDown)
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
         document.removeEventListener("keydown", onKeyDown)
         document.body.style.overflow = previousOverflow
      }
   }, [onClose])

   return (
      <div className="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot">
         <div className="lightbox-backdrop" onClick={onClose} />
         <button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
         </button>
         <div className="lightbox-content">{children}</div>
      </div>
   )
}
