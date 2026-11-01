import type { Anchor } from "@squawk/shared"
import { uniqueTestId } from "../anchor/test-id"
import { elementText } from "../anchor/text"

const TEXT_MAX = 32
/** Containers with more children than this are named by tag only: their text is not a name. */
const TEXT_CHILDREN_MAX = 6

/**
 * Short name of a page element for the hover chip and the composer header, e.g.
 * `button "Save changes"` or `button [save-button]`: the test id when there is one, otherwise the tag
 * with the start of its text, so the reviewer sees what they are about to pin.
 */
export function elementLabel(parts: {
   testId?: string | null
   tagName: string
   text?: string
}): string {
   if (parts.testId) return `${parts.tagName} [${parts.testId}]`
   const text = parts.text?.trim() ?? ""
   if (!text) return parts.tagName
   const short = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1).trimEnd()}…` : text
   return `${parts.tagName} "${short}"`
}

/** Runs on every pointer move in pin mode, so large containers skip reading their text. */
export function labelForElement(element: Element): string {
   return elementLabel({
      testId: uniqueTestId(element),
      tagName: element.localName,
      text: element.childElementCount > TEXT_CHILDREN_MAX ? "" : elementText(element)
   })
}

export function labelForAnchor(anchor: Anchor): string {
   const { selectors } = anchor
   return elementLabel({
      testId: selectors.testId,
      tagName: selectors.tagName,
      text: selectors.text?.exact
   })
}
