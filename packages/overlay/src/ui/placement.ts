export interface Box {
   x: number
   y: number
   width: number
   height: number
}

export type Side = "right" | "left" | "bottom" | "top"

export interface Placement {
   side: Side
   left: number
   top: number
}

export interface PlacementRequest {
   /** What the card must not cover: the pinned element, or the pin itself. */
   avoid: Box
   /** The point the card belongs to; the card lines up with it. */
   point: { x: number; y: number }
   width: number
   height: number
   /** The usable area, normally the viewport minus an open panel. */
   bounds: Box
}

const GAP = 12
const MARGIN = 16
/** How far above the point a card at the side starts, so the point sits near its top. */
const SIDE_LIFT = 40

/** Below this width cards turn into bottom sheets and are not positioned. */
export const SHEET_MAX_WIDTH = 639

export function isNarrowViewport(): boolean {
   return window.innerWidth <= SHEET_MAX_WIDTH
}

/**
 * Places a card right of, left of, below or above `avoid`, whichever comes first without
 * covering it, clamped into the bounds. Falls back to the right side, clamped.
 */
export function placeBeside(request: PlacementRequest): Placement {
   const { avoid, point, width, height, bounds } = request
   const minLeft = bounds.x + MARGIN
   const minTop = bounds.y + MARGIN
   const maxLeft = bounds.x + bounds.width - width - MARGIN
   const maxTop = bounds.y + bounds.height - height - MARGIN
   const clampLeft = (left: number): number => Math.max(minLeft, Math.min(left, maxLeft))
   const clampTop = (top: number): number => Math.max(minTop, Math.min(top, maxTop))
   const candidates: [Placement, ...Placement[]] = [
      { side: "right", left: avoid.x + avoid.width + GAP, top: clampTop(point.y - SIDE_LIFT) },
      { side: "left", left: avoid.x - GAP - width, top: clampTop(point.y - SIDE_LIFT) },
      { side: "bottom", left: clampLeft(point.x - width / 2), top: avoid.y + avoid.height + GAP },
      { side: "top", left: clampLeft(point.x - width / 2), top: avoid.y - GAP - height }
   ]
   const fits = candidates.find(
      ({ left, top }) =>
         left >= minLeft &&
         left <= maxLeft &&
         top >= minTop &&
         top <= maxTop &&
         !overlaps({ x: left, y: top, width, height }, avoid)
   )
   const [first] = candidates
   return fits ?? { ...first, left: clampLeft(first.left) }
}

function overlaps(first: Box, second: Box): boolean {
   return (
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y
   )
}
