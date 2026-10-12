import type { ReactNode } from "react"

interface IconProps {
   size?: number
   className?: string
}

function Icon({ size = 16, className, children }: IconProps & { children: ReactNode }) {
   return (
      <svg
         width={size}
         height={size}
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth={1.75}
         strokeLinecap="round"
         strokeLinejoin="round"
         aria-hidden="true"
         focusable="false"
         className={className}
      >
         {children}
      </svg>
   )
}

export function CheckIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M5 12.5l4.5 4.5L19 7.5" />
      </Icon>
   )
}

export function CloseIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M6 6l12 12M18 6L6 18" />
      </Icon>
   )
}

export function PencilIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z" />
         <path d="M13.5 6.5l4 4" />
      </Icon>
   )
}

export function CopyIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <rect x="9" y="9" width="11" height="11" rx="2" />
         <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </Icon>
   )
}

export function SearchIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <circle cx="11" cy="11" r="6.5" />
         <path d="M20 20l-4-4" />
      </Icon>
   )
}

export function ChevronDownIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M6 9l6 6 6-6" />
      </Icon>
   )
}

export function ChevronRightIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M9 6l6 6-6 6" />
      </Icon>
   )
}

export function BubbleIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />
      </Icon>
   )
}

export function ExternalLinkIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M14 5h5v5" />
         <path d="M19 5l-9 9" />
         <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
      </Icon>
   )
}

export function LinkIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8" />
         <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
      </Icon>
   )
}

export function TerminalIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M5 7l5 5-5 5" />
         <path d="M12 18h7" />
      </Icon>
   )
}

/** Four-pointed sparkle with a small companion, for agents writing on someone's behalf. */
export function SparkleIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z" />
         <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </Icon>
   )
}

export function ImageIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <rect x="4" y="5" width="16" height="14" rx="2" />
         <circle cx="9" cy="10" r="1.5" />
         <path d="M20 15l-4.5-4.5L7 19" />
      </Icon>
   )
}

export function KeyIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <circle cx="8" cy="14" r="4" />
         <path d="M10.8 11.2L20 2M16 6l2.5 2.5M13 9l2.5 2.5" />
      </Icon>
   )
}

export function InboxIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M4 13h4l2 3h4l2-3h4" />
         <path d="M6 5h12l2 8v6H4v-6l2-8z" />
      </Icon>
   )
}

export function AlertIcon(props: IconProps) {
   return (
      <Icon {...props}>
         <path d="M12 9v4" />
         <path d="M12 17h.01" />
         <path d="M10.3 4.3L3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </Icon>
   )
}
