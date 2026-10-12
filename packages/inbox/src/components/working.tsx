import type { Working } from "@squawk/shared"
import { formatDateTime, formatDuration } from "../lib/format"
import { authorName, authorTitle } from "./author"
import { SparkleIcon } from "./icons"

function workingSentence(working: Working): string {
   return `${authorName(working.by)} is working on this`
}

/** Small pulsing chip for list rows: an agent has claimed the squawk, and for how long. */
export function WorkingIndicator({ working }: { working: Working }) {
   return (
      <span
         className="working-indicator"
         title={`${workingSentence(working)} since ${formatDateTime(working.since)}`}
      >
         <SparkleIcon size={12} className="working-sparkle" />
         <span>working · {formatDuration(working.since)}</span>
      </span>
   )
}

/** Banner on top of a thread while an agent works on it, with a way to clear a stale claim. */
export function WorkingBanner({
   working,
   busy,
   onClear
}: {
   working: Working
   busy: boolean
   onClear: () => void
}) {
   return (
      <div className="working-banner" role="status">
         <SparkleIcon size={16} className="working-sparkle" />
         <span className="working-banner-text">
            <strong title={authorTitle(working.by)}>{authorName(working.by)}</strong> is working on
            this
            <span className="working-banner-since" title={formatDateTime(working.since)}>
               {" · since "}
               {formatDuration(working.since)}
            </span>
         </span>
         <button
            type="button"
            className="button button-ghost button-small"
            disabled={busy}
            onClick={onClear}
            title="Remove the mark, for example when the agent stopped without answering"
         >
            Clear
         </button>
      </div>
   )
}
