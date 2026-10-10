import { toPng } from "html-to-image"

/**
 * Renders the visible viewport from the DOM with html-to-image: the document element is cloned at
 * viewport size and shifted by the scroll offset, so the SVG canvas clips to what the user sees.
 * Approximate: fixed-position elements, cross-origin images and some CSS may be off.
 */
export function captureDomScreenshot(exclude: Element): Promise<string> {
   const root = document.documentElement
   return toPng(root, {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: pageBackground(),
      filter: node => node !== exclude,
      style: {
         transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
         transformOrigin: "0 0"
      }
   })
}

function pageBackground(): string {
   for (const element of [document.body, document.documentElement]) {
      if (!element) continue
      const color = getComputedStyle(element).backgroundColor
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color
   }
   return "#ffffff"
}
