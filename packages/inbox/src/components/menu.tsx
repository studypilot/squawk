import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"

/**
 * A button that toggles a small floating panel. Closes on Escape, on a click outside and when
 * `closeSignal` changes (for example after a choice).
 */
export function Menu({
   trigger,
   children,
   align = "end",
   className,
   closeSignal,
   triggerClassName = "button button-secondary",
   triggerLabel
}: {
   trigger: ReactNode
   children: ReactNode
   align?: "start" | "end"
   className?: string
   closeSignal?: unknown
   triggerClassName?: string
   triggerLabel?: string
}) {
   const [open, setOpen] = useState(false)
   const container = useRef<HTMLDivElement>(null)
   const id = useId()

   useEffect(() => {
      setOpen(false)
   }, [closeSignal])

   useEffect(() => {
      if (!open) {
         return
      }
      function onPointerDown(event: PointerEvent) {
         if (!container.current?.contains(event.target as Node)) {
            setOpen(false)
         }
      }
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === "Escape") {
            setOpen(false)
         }
      }
      document.addEventListener("pointerdown", onPointerDown)
      document.addEventListener("keydown", onKeyDown)
      return () => {
         document.removeEventListener("pointerdown", onPointerDown)
         document.removeEventListener("keydown", onKeyDown)
      }
   }, [open])

   return (
      <div ref={container} className={className === undefined ? "menu" : `menu ${className}`}>
         <button
            type="button"
            className={triggerClassName}
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls={id}
            aria-label={triggerLabel}
            onClick={() => setOpen(current => !current)}
         >
            {trigger}
         </button>
         {open && (
            <div id={id} className={`menu-panel menu-panel-${align}`}>
               {children}
            </div>
         )}
      </div>
   )
}
