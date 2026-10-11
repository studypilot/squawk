import type { ReactNode } from "react"

export function EmptyState({
   icon,
   title,
   hint,
   children,
   compact = false
}: {
   icon: ReactNode
   title: string
   hint?: ReactNode
   children?: ReactNode
   compact?: boolean
}) {
   return (
      <div className={compact ? "empty-state empty-state-compact" : "empty-state"}>
         <span className="empty-state-icon">{icon}</span>
         <p className="empty-state-title">{title}</p>
         {hint !== undefined && <p className="empty-state-hint">{hint}</p>}
         {children}
      </div>
   )
}
