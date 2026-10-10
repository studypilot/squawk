/** Longest text quote an anchor stores (mirrors `textQuoteSchema`). */
export const QUOTE_MAX_LENGTH = 500

/** Collapses whitespace runs and trims, so innerText and textContent compare sensibly. */
export function normalizeText(text: string): string {
   return text.replace(/\s+/g, " ").trim()
}

/** Rendered text of an element; falls back to textContent where innerText is missing (jsdom). */
export function elementText(element: Element): string {
   const innerText = (element as HTMLElement).innerText
   return normalizeText(typeof innerText === "string" ? innerText : (element.textContent ?? ""))
}
