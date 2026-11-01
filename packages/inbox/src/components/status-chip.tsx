import type { SquawkStatus } from "@squawk/shared"
import { CheckIcon } from "./icons"

const LABELS: Record<SquawkStatus, string> = { draft: "Draft", open: "Open", resolved: "Resolved" }

export function StatusChip({ status, dismissed }: { status: SquawkStatus; dismissed: boolean }) {
   return (
      <span className={`chip chip-${status}${dismissed ? " chip-dismissed" : ""}`}>
         {status === "open" ? <span className="chip-dot" /> : <CheckIcon size={11} />}
         <span className="chip-label">{dismissed ? "Dismissed" : LABELS[status]}</span>
      </span>
   )
}
