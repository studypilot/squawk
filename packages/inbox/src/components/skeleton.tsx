/** A loading placeholder sized like the content it stands in for. */
export function Skeleton({
   width,
   height = 12,
   className,
   radius
}: {
   width?: number | string
   height?: number | string
   className?: string
   radius?: number | string
}) {
   return (
      <span
         className={className === undefined ? "skeleton" : `skeleton ${className}`}
         style={{ width, height, borderRadius: radius }}
         aria-hidden="true"
      />
   )
}

export function SkeletonRows({ rows, children }: { rows: number; children: React.ReactNode }) {
   return (
      <div className="skeleton-rows" role="status" aria-label="Loading">
         {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="skeleton-row">
               {children}
            </div>
         ))}
      </div>
   )
}
