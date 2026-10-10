import type { Anchor, TextQuote } from "@squawk/shared"
import { QUOTE_MAX_LENGTH, elementText } from "./text"
import { findByTestId } from "./test-id"

export interface ResolvedAnchor {
   element: Element
   /** `exact`: a selector hit whose text still matches. `fuzzy`: found by text or text changed. */
   confidence: "exact" | "fuzzy"
}

const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Finds the anchored element again: testId, then css, then xpath, then the text quote. Every
 * hit must be connected, have the recorded tag name and a non-empty box.
 */
export function resolveAnchor(anchor: Anchor, root: Document = document): ResolvedAnchor | null {
   const { selectors } = anchor
   const tagName = selectors.tagName.toLowerCase()

   if (selectors.testId) {
      const element = findByTestId(root, selectors.testId).find(match =>
         isPlausible(match, tagName)
      )
      if (element) return { element, confidence: "exact" }
   }

   let structuralMatch: Element | null = null
   for (const candidate of [queryCss(root, selectors.css), queryXPath(root, selectors.xpath)]) {
      if (!candidate || !isPlausible(candidate, tagName)) continue
      if (!selectors.text || textEquals(candidate, selectors.text.exact)) {
         return { element: candidate, confidence: "exact" }
      }
      structuralMatch ??= candidate
   }

   const textMatch = selectors.text ? findByText(root, tagName, selectors.text) : null
   if (textMatch) return { element: textMatch, confidence: "fuzzy" }
   return structuralMatch ? { element: structuralMatch, confidence: "fuzzy" } : null
}

function isPlausible(element: Element, tagName: string): boolean {
   if (!element.isConnected || element.localName.toLowerCase() !== tagName) return false
   const box = element.getBoundingClientRect()
   return box.width > 0 && box.height > 0
}

function queryCss(root: Document, selector: string | undefined): Element | null {
   if (!selector) return null
   try {
      return root.querySelector(selector)
   } catch {
      return null
   }
}

function queryXPath(root: Document, xpath: string | undefined): Element | null {
   if (!xpath) return null
   try {
      const result = root.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      return result.singleNodeValue instanceof Element ? result.singleNodeValue : null
   } catch {
      return null
   }
}

/** Equal text, or same beginning when the recorded quote was cut at its maximum length. */
function textEquals(element: Element, exact: string): boolean {
   const text = elementText(element).toLowerCase()
   const wanted = exact.toLowerCase()
   return exact.length >= QUOTE_MAX_LENGTH ? text.startsWith(wanted) : text === wanted
}

/**
 * Elements of the recorded tag whose text contains the quote. Prefers exact text equality and
 * matching context, then the smallest element.
 */
function findByText(root: Document, tagName: string, quote: TextQuote): Element | null {
   if (!TAG_NAME_PATTERN.test(tagName)) return null
   const wanted = quote.exact.toLowerCase()
   const wantedCompact = wanted.replace(/\s/g, "")
   let best: { element: Element; score: number; length: number } | null = null
   for (const element of root.querySelectorAll(tagName)) {
      const compact = (element.textContent ?? "").replace(/\s/g, "").toLowerCase()
      if (!compact.includes(wantedCompact)) continue
      const text = elementText(element).toLowerCase()
      if (!text.includes(wanted) || !isPlausible(element, tagName)) continue
      const score = (text === wanted ? 2 : 0) + contextScore(element, quote)
      const better =
         !best || score > best.score || (score === best.score && text.length < best.length)
      if (better) best = { element, score, length: text.length }
   }
   return best?.element ?? null
}

function contextScore(element: Element, quote: TextQuote): number {
   if (!quote.prefix && !quote.suffix) return 0
   const parentText = element.parentElement ? elementText(element.parentElement) : ""
   const prefixMatches = quote.prefix && parentText.includes(quote.prefix + quote.exact) ? 1 : 0
   const suffixMatches = quote.suffix && parentText.includes(quote.exact + quote.suffix) ? 1 : 0
   return prefixMatches + suffixMatches
}
