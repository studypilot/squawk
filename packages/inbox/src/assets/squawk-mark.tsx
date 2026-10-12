/** The Squawk mark (brand/squawk-mark.svg): a bird-shaped speech bubble outline in the text colour. */
const MARK_PATH =
   "M30 11c11 0 19 7 20 16 5 0 9 2 11 5-2 3-6 5-11 5-2 9-10 15-20 15-5 0-9-1-12-3-3 3-7 4-11 4 3-3 4-6 4-9-2-3-3-6-3-10 0-13 10-23 22-23z"

/** Thicker strokes and a bigger eye at small sizes, so the outline never thins out. */
function strokeFor(size: number): { strokeWidth: number; eyeRadius: number } {
   if (size >= 48) return { strokeWidth: 5, eyeRadius: 3.2 }
   if (size >= 24) return { strokeWidth: 6, eyeRadius: 3.6 }
   if (size >= 17) return { strokeWidth: 7, eyeRadius: 4 }
   return { strokeWidth: 8, eyeRadius: 4.5 }
}

export function SquawkMark({ size = 20, className }: { size?: number; className?: string }) {
   const { strokeWidth, eyeRadius } = strokeFor(size)
   return (
      <svg
         width={size}
         height={size}
         viewBox="0 0 64 64"
         fill="none"
         aria-hidden="true"
         focusable="false"
         className={className}
      >
         <path
            d={MARK_PATH}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
         />
         <circle cx="38" cy="26" r={eyeRadius} fill="currentColor" />
      </svg>
   )
}
