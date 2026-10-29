import { finder } from "@medv/finder"
import { layoutViewport } from "../viewport"
import type { Anchor, AnchorBox, TextQuote } from "@squawk/shared"
import { QUOTE_MAX_LENGTH, elementText } from "./text"
import { uniqueTestId } from "./test-id"

const INTERACTIVE_ANCESTOR_LEVELS = 3
const QUOTE_CONTEXT_LENGTH = 32
const SELECTOR_MAX_LENGTH = 2000
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml"
const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
/** A click on these means the control, not the icon or label inside it. */
const INTERACTIVE_SELECTOR = [
   "button",
   "a",
   "summary",
   "label",
   '[role="button"]',
   '[role="link"]',
   '[role="menuitem"]',
   '[role="menuitemcheckbox"]',
   '[role="menuitemradio"]',
   '[role="tab"]',
   '[role="option"]',
   '[role="checkbox"]',
   '[role="radio"]',
   '[role="switch"]'
].join(",")

/**
 * The element an anchor is recorded for. The clicked element itself, so that small things deep
 * in the tree can be pinned, with two exceptions: a click inside an inline SVG means the whole
 * icon, and a click on the icon or label of a control (up to three levels down) means the
 * control.
 */
export function anchorTarget(element: Element): Element {
   let current: Element | null = svgRoot(element)
   for (let level = 0; current && level <= INTERACTIVE_ANCESTOR_LEVELS; level++) {
      if (current === document.body || current === document.documentElement) break
      if (current.matches(INTERACTIVE_SELECTOR)) return current
      current = current.parentElement
   }
   return svgRoot(element)
}

function svgRoot(element: Element): Element {
   let current: Element | null = element
   let root = element
   while (current && current.namespaceURI === SVG_NAMESPACE) {
      root = current
      current = current.parentElement
   }
   return root
}

/**
 * The element an area is recorded for: the smallest element under the area's centre whose box
 * contains the whole rectangle, with a little tolerance for borders and shadows.
 */
export function areaTarget(elementAtCentre: Element, area: AnchorBox): Element {
   const tolerance = 2
   let current: Element | null = elementAtCentre
   while (current && current !== document.documentElement) {
      const box = current.getBoundingClientRect()
      const contains =
         box.left - tolerance <= area.x &&
         box.top - tolerance <= area.y &&
         box.right + tolerance >= area.x + area.width &&
         box.bottom + tolerance >= area.y + area.height
      if (contains) return current
      current = current.parentElement
   }
   return document.body
}

/**
 * Records everything needed to find the clicked spot again. Coordinates are client coordinates.
 * With `area`, `element` is its containing element (see `areaTarget`) and the point is the
 * area's top-left corner.
 */
export function captureAnchor(
   clicked: Element,
   clientX: number,
   clientY: number,
   area?: AnchorBox
): Anchor {
   const element = area ? clicked : anchorTarget(clicked)
   const box = element.getBoundingClientRect()
   const testId = uniqueTestId(element)
   const css = cssSelector(element)
   const text = textQuote(element)
   return {
      version: 1,
      selectors: {
         ...(testId ? { testId } : {}),
         ...(css ? { css } : {}),
         xpath: absoluteXPath(element).slice(0, SELECTOR_MAX_LENGTH),
         ...(text ? { text } : {}),
         tagName: element.localName.toLowerCase().slice(0, 50)
      },
      rect: {
         x: relativePosition(clientX - box.left, box.width),
         y: relativePosition(clientY - box.top, box.height)
      },
      page: {
         x: clientX + window.scrollX,
         y: clientY + window.scrollY,
         scrollX: window.scrollX,
         scrollY: window.scrollY
      },
      elementBox: { x: box.left, y: box.top, width: box.width, height: box.height },
      ...(area ? { area: { ...area } } : {}),
      viewport: layoutViewport()
   }
}

function relativePosition(offset: number, size: number): number {
   if (size <= 0) return 0.5
   return Math.min(1, Math.max(0, offset / size))
}

function cssSelector(element: Element): string | undefined {
   try {
      const selector = finder(element, { seedMinLength: 4, optimizedMinLength: 2 })
      return selector.length <= SELECTOR_MAX_LENGTH ? selector : undefined
   } catch {
      return undefined
   }
}

/** Absolute XPath; positions are only added where siblings share the tag name. */
export function absoluteXPath(element: Element): string {
   const steps: string[] = []
   for (let node: Element | null = element; node; node = node.parentElement) {
      const name = node.localName
      const step = node.namespaceURI === XHTML_NAMESPACE ? name : `*[local-name()="${name}"]`
      const parent: Element | null = node.parentElement
      const siblings = parent ? [...parent.children].filter(child => child.localName === name) : []
      steps.unshift(siblings.length > 1 ? `${step}[${siblings.indexOf(node) + 1}]` : step)
   }
   return `/${steps.join("/")}`
}

function textQuote(element: Element): TextQuote | undefined {
   const text = elementText(element)
   if (!text) return undefined
   const quote: TextQuote = { exact: text.slice(0, QUOTE_MAX_LENGTH) }
   const parent = element.parentElement
   if (!parent) return quote
   const parentText = elementText(parent)
   const index = parentText.indexOf(quote.exact)
   if (index === -1) return quote
   const prefix = parentText.slice(Math.max(0, index - QUOTE_CONTEXT_LENGTH), index)
   const end = index + quote.exact.length
   const suffix = parentText.slice(end, end + QUOTE_CONTEXT_LENGTH)
   if (prefix) quote.prefix = prefix
   if (suffix) quote.suffix = suffix
   return quote
}
