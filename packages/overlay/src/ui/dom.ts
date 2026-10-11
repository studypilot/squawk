import type { Author } from "@squawk/shared"

type AttributeValue = string | number | boolean | null | undefined | ((event: Event) => void)
type Child = Node | string | null | undefined | false

/**
 * Creates an element. Attributes named `on<event>` become listeners, `true` sets an empty
 * attribute, `false`/null/undefined skip it. Strings become text nodes, never HTML.
 */
export function h<Tag extends keyof HTMLElementTagNameMap>(
   tag: Tag,
   attributes: Record<string, AttributeValue> = {},
   children: Child[] = []
): HTMLElementTagNameMap[Tag] {
   const element = document.createElement(tag)
   for (const [name, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue
      if (typeof value === "function") element.addEventListener(name.slice(2), value)
      else element.setAttribute(name, value === true ? "" : String(value))
   }
   for (const child of children) {
      if (child !== null && child !== undefined && child !== false) element.append(child)
   }
   return element
}

/** Stroke icons on a 16px grid, drawn with a 1.5px stroke. */
const ICONS = {
   comment:
      '<path d="M13.5 9.5a2 2 0 0 1-2 2H7.5L4 14v-2.5A1.5 1.5 0 0 1 2.5 10V4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2z"/>',
   plus: '<path d="M8 3.5v9M3.5 8h9"/>',
   close: '<path d="M4 4l8 8M12 4l-8 8"/>',
   back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
   check: '<path d="M3.5 8.5l3 3 6-7"/>',
   link: '<path d="M6.5 9.5l3-3M7 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1M9 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1"/>',
   image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 10.5l3-3 3 3 2-2 3 3"/><circle cx="10.5" cy="6" r="1" fill="currentColor" stroke="none"/>',
   info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.5v3.5M8 5.25v.1"/>',
   robot: '<rect x="3" y="5.5" width="10" height="7.5" rx="2"/><path d="M8 3v2.5M6.5 11h3"/><circle cx="6" cy="8.75" r=".75" fill="currentColor" stroke="none"/><circle cx="10" cy="8.75" r=".75" fill="currentColor" stroke="none"/>',
   reopen: '<path d="M3 8a5 5 0 1 0 1.6-3.65M3 2.5V5h2.5"/>',
   external:
      '<path d="M9.5 2.5h4v4M13.5 2.5L8 8M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7"/>',
   expand: '<path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/>',
   inbox: '<path d="M2.5 9h3l1 2h3l1-2h3M2.5 9V4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V9M2.5 9v2.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9"/>'
} as const

export type IconName = keyof typeof ICONS

/** Inline stroke icon; the markup is a constant from this module. */
export function icon(name: IconName, size = 16): SVGSVGElement {
   const template = document.createElement("template")
   template.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
   return template.content.firstElementChild as SVGSVGElement
}

/** The studypilot plane, from the renderer's logo_transparent.svg, filled with currentColor. */
const PLANE_PATH =
   "M204.966 28.1217C203.75 29.3369 199.715 33.4436 198.639 34.6624L176.051 58.4662C175.938 58.5941 175.791 58.6883 175.628 58.7381C175.465 58.7879 175.291 58.7915 175.125 58.7485L72.5045 48.7552C71.8517 48.6643 71.187 48.7163 70.5563 48.9076C69.9255 49.0989 69.3439 49.425 68.8517 49.8632L59.2408 59.4741L142.876 90.9265C143.07 90.996 143.242 91.1147 143.376 91.2711C143.511 91.4274 143.602 91.616 143.641 91.8182C143.68 92.0204 143.666 92.2294 143.601 92.4246C143.535 92.6198 143.419 92.7946 143.265 92.9316L100.415 137.069C99.976 137.535 99.4334 137.891 98.831 138.109C98.2287 138.326 97.5835 138.398 96.948 138.32L67.6401 135.46C65.1739 135.139 62.4147 136.397 60.6669 138.144L53.9261 144.885C53.465 145.346 53.9654 145.711 54.5265 146.022L87.1441 164.457C89.0472 165.288 90.5663 166.807 91.3974 168.711L109.747 201.257C110.233 202.165 110.633 202.515 111.452 201.696L117.857 195.291C120.766 192.382 120.784 191.606 120.398 188.247L117.539 158.438C117.465 157.803 117.54 157.16 117.757 156.558C117.974 155.957 118.327 155.414 118.79 154.972L162.887 112.804C163.048 112.65 163.244 112.538 163.457 112.478C163.671 112.417 163.896 112.409 164.114 112.456C164.331 112.502 164.534 112.6 164.704 112.742C164.875 112.885 165.008 113.067 165.093 113.272L196.488 196.721L206.009 187.2C206.447 186.708 206.772 186.128 206.963 185.498C207.155 184.869 207.207 184.206 207.117 183.554L197.253 80.8689C197.178 80.515 197.646 79.8324 197.892 79.5858L221.339 57.3546C222.59 56.2466 226.661 52.2472 227.879 51.0284C243.702 35.2057 249.36 20.8484 242.237 13.7251C235.114 6.60183 220.835 12.2525 204.966 28.1217Z"

export function planeMark(size = 18): SVGSVGElement {
   const template = document.createElement("template")
   template.innerHTML = `<svg class="mark" viewBox="46 6 210 210" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${PLANE_PATH}"/></svg>`
   return template.content.firstElementChild as SVGSVGElement
}

/** Button-sized spinner; the rotation lives in CSS so reduced-motion can slow it down. */
export function spinner(): SVGSVGElement {
   const template = document.createElement("template")
   template.innerHTML =
      '<svg class="spinner" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M8 2.25A5.75 5.75 0 1 1 2.25 8"/></svg>'
   return template.content.firstElementChild as SVGSVGElement
}

function hueOf(name: string): number {
   let hash = 0
   for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
   return hash % 360
}

function initialsOf(name: string): string {
   const words = name
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
   const first = words[0]
   const last = words[words.length - 1]
   if (!first || !last) return "?"
   if (words.length === 1) return first.slice(0, 2).toUpperCase()
   return (first.charAt(0) + last.charAt(0)).toUpperCase()
}

/** Initials on a colour derived from the name; agents get the robot glyph instead. */
export function avatar(author: Author, size: 20 | 24 = 24): HTMLElement {
   const element = h("span", { class: `avatar avatar-${size}`, "aria-hidden": "true" })
   if (author.kind === "agent") {
      element.classList.add("is-agent")
      element.append(icon("robot", size === 24 ? 14 : 12))
      return element
   }
   const name = author.name || author.email
   if (author.avatarUrl) {
      element.append(h("img", { src: author.avatarUrl, alt: "" }))
      return element
   }
   element.style.background = `hsl(${hueOf(name)} 55% 45%)`
   element.textContent = initialsOf(name)
   return element
}

/** Grows a textarea with its content between `minLines` and `maxLines` lines. */
export function autoGrow(textarea: HTMLTextAreaElement, minLines: number, maxLines: number): void {
   textarea.rows = minLines
   const resize = (): void => {
      textarea.style.height = "auto"
      const style = getComputedStyle(textarea)
      const lineHeight = parseFloat(style.lineHeight) || 20
      const frame =
         textarea.offsetHeight -
         textarea.clientHeight +
         (parseFloat(style.paddingTop) || 0) +
         (parseFloat(style.paddingBottom) || 0)
      const maxHeight = lineHeight * maxLines + frame
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden"
   }
   textarea.addEventListener("input", resize)
   requestAnimationFrame(resize)
}
