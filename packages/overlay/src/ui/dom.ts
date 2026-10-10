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

const ICONS = {
   comment:
      '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/>',
   plus: '<path d="M12 5v14M5 12h14"/>',
   close: '<path d="M6 6l12 12M18 6L6 18"/>',
   back: '<path d="M15 5l-7 7 7 7"/>'
} as const

export type IconName = keyof typeof ICONS

/** Inline stroke icon; the markup is a constant from this module. */
export function icon(name: IconName): SVGSVGElement {
   const template = document.createElement("template")
   template.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
   return template.content.firstElementChild as SVGSVGElement
}
