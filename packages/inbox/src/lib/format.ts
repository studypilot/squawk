const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

const SECONDS_PER_UNIT: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
   ["year", 365 * 24 * 60 * 60],
   ["month", 30 * 24 * 60 * 60],
   ["week", 7 * 24 * 60 * 60],
   ["day", 24 * 60 * 60],
   ["hour", 60 * 60],
   ["minute", 60]
]

/** "3 minutes ago", "in 2 days", "just now". */
export function formatRelativeTime(isoDate: string, now: Date = new Date()): string {
   const seconds = (new Date(isoDate).getTime() - now.getTime()) / 1000
   if (Math.abs(seconds) < 45) {
      return "just now"
   }
   for (const [unit, unitSeconds] of SECONDS_PER_UNIT) {
      if (Math.abs(seconds) >= unitSeconds) {
         return relativeTimeFormatter.format(Math.round(seconds / unitSeconds), unit)
      }
   }
   return relativeTimeFormatter.format(Math.round(seconds / 60), "minute")
}

export function formatDateTime(isoDate: string): string {
   return new Date(isoDate).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })
}

export function truncate(text: string, maxLength: number): string {
   if (text.length <= maxLength) {
      return text
   }
   return `${text.slice(0, maxLength - 1)}…`
}

/** Number of characters in a device user code, without the dash (`WXYZ-1234`). */
export const USER_CODE_LENGTH = 8

/**
 * Normalises whatever the user typed or pasted into the `WXYZ-1234` shape: upper case, only
 * letters and digits, at most eight of them, and a dash after the fourth.
 */
export function formatUserCode(input: string): string {
   const characters = input
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, USER_CODE_LENGTH)
   const half = USER_CODE_LENGTH / 2
   if (characters.length <= half) {
      return characters
   }
   return `${characters.slice(0, half)}-${characters.slice(half)}`
}

export function isCompleteUserCode(code: string): boolean {
   return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)
}
