import type { SquawkStatus } from "@squawk/shared"
import { CheckIcon } from "./icons"

const LABELS: Record<SquawkStatus, string> = { open: "Open", resolved: "Resolved" }

export function StatusChip({ status }: { status: SquawkStatus }) {
   return (
      <span className={`chip chip-${status}`}>
         {status === "open" ? <span className="chip-dot" /> : <CheckIcon size={11} />}
         <span className="chip-label">{LABELS[status]}</span>
      </span>
   )
}
