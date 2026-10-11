export interface SegmentedOption<T extends string> {
   value: T
   label: string
   count?: number
}

/** A row of mutually exclusive choices, like a tab bar without routing. */
export function Segmented<T extends string>({
   value,
   options,
   onChange,
   label,
   size = "default"
}: {
   value: T
   options: ReadonlyArray<SegmentedOption<T>>
   onChange: (value: T) => void
   label: string
   size?: "default" | "small"
}) {
   return (
      <div
         className={size === "small" ? "segmented segmented-small" : "segmented"}
         role="radiogroup"
         aria-label={label}
      >
         {options.map(option => (
            <button
               key={option.value}
               type="button"
               role="radio"
               aria-checked={option.value === value}
               className={option.value === value ? "segment segment-active" : "segment"}
               onClick={() => onChange(option.value)}
            >
               {option.label}
               {option.count !== undefined && <span className="segment-count">{option.count}</span>}
            </button>
         ))}
      </div>
   )
}
