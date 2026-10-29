import { z } from "zod"

/**
 * A text quote taken from the anchored element's `innerText`, with up to 32 characters of
 * context on each side, in the spirit of the W3C TextQuoteSelector.
 */
export const textQuoteSchema = z.object({
   exact: z.string().max(500),
   prefix: z.string().max(64).optional(),
   suffix: z.string().max(64).optional()
})

const boxSchema = z.object({
   x: z.number(),
   y: z.number(),
   width: z.number(),
   height: z.number()
})

/**
 * Everything the overlay records to find a pinned element again. Selectors are tried in the
 * order testId, css, xpath, text; `page` is the last resort and marks the pin as orphaned.
 *
 * A squawk pins either a point on an element (the click) or an area the reviewer dragged out.
 * For an area, the element is the smallest one that contains the whole rectangle, and the pin
 * (`rect`, `page`) sits at the rectangle's top-left corner.
 */
export const anchorSchema = z.object({
   version: z.literal(1),
   selectors: z.object({
      /** Value of data-testid, data-test or id, whichever the element has first. */
      testId: z.string().max(300).optional(),
      /** Shortest unique CSS selector at capture time. */
      css: z.string().max(2000).optional(),
      /** Absolute XPath from the document root. */
      xpath: z.string().max(2000).optional(),
      text: textQuoteSchema.optional(),
      /** Lower-cased tag name, used to sanity-check matches. */
      tagName: z.string().max(50)
   }),
   /** Click point relative to the element's box, both in 0..1. */
   rect: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1)
   }),
   /** Click point in document coordinates plus the scroll offset at capture time. */
   page: z.object({
      x: z.number(),
      y: z.number(),
      scrollX: z.number(),
      scrollY: z.number()
   }),
   /** Element box in viewport coordinates at capture time, for drawing the marker on the screenshot. */
   elementBox: boxSchema,
   /**
    * The dragged rectangle in viewport coordinates at capture time, only for area squawks. On
    * the page it moves and scales with the element, on the screenshot it is drawn as recorded.
    */
   area: boxSchema
      .extend({ width: z.number().positive(), height: z.number().positive() })
      .optional(),
   viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
   })
})

export type Anchor = z.infer<typeof anchorSchema>
export type TextQuote = z.infer<typeof textQuoteSchema>
export type AnchorBox = z.infer<typeof boxSchema>
