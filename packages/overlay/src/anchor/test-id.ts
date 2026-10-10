const TEST_ID_ATTRIBUTES = ["data-testid", "data-test", "id"] as const

function quoteAttributeValue(value: string): string {
   return `"${value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`
}

/**
 * Elements carrying `value` in data-testid, data-test or id, in that order. An element that
 * carries the value in more than one attribute is listed once.
 */
export function findByTestId(root: ParentNode, value: string): Element[] {
   const matches = new Set<Element>()
   for (const attribute of TEST_ID_ATTRIBUTES) {
      for (const element of root.querySelectorAll(`[${attribute}=${quoteAttributeValue(value)}]`)) {
         matches.add(element)
      }
   }
   return [...matches]
}

/**
 * The element's own test id (data-testid, data-test or id, first one present), but only if it
 * identifies exactly one element in the document. Generated React ids (`:r1:`) are skipped.
 */
export function uniqueTestId(element: Element): string | null {
   for (const attribute of TEST_ID_ATTRIBUTES) {
      const value = element.getAttribute(attribute)
      if (!value || value.length > 300) continue
      if (attribute === "id" && value.includes(":")) continue
      if (findByTestId(element.ownerDocument, value).length === 1) return value
   }
   return null
}
