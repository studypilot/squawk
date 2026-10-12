import type { Author } from "@squawk/shared"
import { authorKey, authorTooltip, isAgent } from "./format"

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
   sparkle:
      '<path d="M8 2.5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5z" fill="currentColor"/><path d="M12.5 10.5v3M11 12h3"/>',
   pencil: '<path d="M10.5 3.5l2 2L6 12l-2.5.5L4 10z"/>',
   trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"/>',
   reopen: '<path d="M3 8a5 5 0 1 0 1.6-3.65M3 2.5V5h2.5"/>',
   external:
      '<path d="M9.5 2.5h4v4M13.5 2.5L8 8M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7"/>',
   expand: '<path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/>',
   send: '<path d="M2.5 8l11-5-4 11-2-4.5z"/>',
   inbox: '<path d="M2.5 9h3l1 2h3l1-2h3M2.5 9V4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V9M2.5 9v2.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9"/>'
} as const

export type IconName = keyof typeof ICONS

/** Inline stroke icon; the markup is a constant from this module. */
export function icon(name: IconName, size = 16): SVGSVGElement {
   const template = document.createElement("template")
   template.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
   return template.content.firstElementChild as SVGSVGElement
}

/** The Squawk mark (brand/squawk-mark.svg): a bird-shaped speech bubble outline. */
const MARK_PATH =
   "M30 11c11 0 19 7 20 16 5 0 9 2 11 5-2 3-6 5-11 5-2 9-10 15-20 15-5 0-9-1-12-3-3 3-7 4-11 4 3-3 4-6 4-9-2-3-3-6-3-10 0-13 10-23 22-23z"

/** Outline in currentColor; strokes and eye grow at small sizes so the lines never thin out. */
export function squawkMark(size = 18): SVGSVGElement {
   const [strokeWidth, eyeRadius] =
      size >= 48 ? [5, 3.2] : size >= 24 ? [6, 3.6] : size >= 17 ? [7, 4] : [8, 4.5]
   const template = document.createElement("template")
   template.innerHTML = `<svg class="mark" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" aria-hidden="true"><path d="${MARK_PATH}" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round"/><circle cx="38" cy="26" r="${eyeRadius}" fill="currentColor"/></svg>`
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

/** Initials on a colour derived from the name; agents get the sparkle in the brand colour. */
export function avatar(author: Author, size: 20 | 24 = 24): HTMLElement {
   const element = h("span", {
      class: `avatar avatar-${size}`,
      title: authorTooltip(author),
      "aria-hidden": "true"
   })
   if (isAgent(author)) {
      element.classList.add("is-agent")
      element.append(icon("sparkle", size === 24 ? 14 : 12))
      return element
   }
   if (author.kind === "agent") return element
   const name = author.name || author.email
   if (author.avatarUrl) {
      element.append(h("img", { src: author.avatarUrl, alt: "" }))
      return element
   }
   element.style.background = `hsl(${hueOf(name)} 55% 45%)`
   element.textContent = initialsOf(name)
   return element
}

/** Overlapping avatars of distinct authors, at most `limit`. */
export function avatarStack(authors: Author[], limit = 2): HTMLElement {
   const seen = new Set<string>()
   const unique = authors.filter(author => {
      const key = authorKey(author)
      if (seen.has(key)) return false
      seen.add(key)
      return true
   })
   return h(
      "span",
      { class: "avatar-stack" },
      unique.slice(0, limit).map(author => avatar(author, 24))
   )
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
