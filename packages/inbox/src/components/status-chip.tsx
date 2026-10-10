import type { SquawkStatus } from "@squawk/shared"

const LABELS: Record<SquawkStatus, string> = { open: "Open", resolved: "Resolved" }

export function StatusChip({ status }: { status: SquawkStatus }) {
   return <span className={`chip chip-${status}`}>{LABELS[status]}</span>
}
