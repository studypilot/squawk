import { formatDateTime, formatRelativeTime } from "../lib/format"

export function RelativeTime({ value }: { value: string }) {
   return (
      <time dateTime={value} title={formatDateTime(value)}>
         {formatRelativeTime(value)}
      </time>
   )
}
