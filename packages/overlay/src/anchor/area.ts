import type { Anchor, AnchorBox } from "@squawk/shared"

/**
 * Where a recorded area sits now, given the current box of its element: the area keeps its
 * position and size relative to the element, so it follows scrolling and modest relayouts. An
 * element box without extent (not laid out at capture time) leaves the area where it was.
 */
export function areaOnElement(anchor: Anchor, elementBox: AnchorBox): AnchorBox | null {
   const { area, elementBox: captured } = anchor
   if (!area) return null
   if (captured.width <= 0 || captured.height <= 0) return { ...area }
   const scaleX = elementBox.width / captured.width
   const scaleY = elementBox.height / captured.height
   return {
      x: elementBox.x + (area.x - captured.x) * scaleX,
      y: elementBox.y + (area.y - captured.y) * scaleY,
      width: area.width * scaleX,
      height: area.height * scaleY
   }
}

/** The pinned point in viewport coordinates at capture time: the click, or the area's corner. */
export function capturedPoint(anchor: Anchor): { x: number; y: number } {
   return {
      x: anchor.elementBox.x + anchor.rect.x * anchor.elementBox.width,
      y: anchor.elementBox.y + anchor.rect.y * anchor.elementBox.height
   }
}
