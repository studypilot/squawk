/**
 * The layout viewport in CSS pixels. `window.innerWidth/innerHeight` follow the *visual*
 * viewport on iOS: they shrink while the keyboard is up and while Safari is zoomed into a
 * focused field, so a squawk sent from the composer reported a 351×338 phone. The document
 * element's client size is the layout viewport and stays stable through both.
 */
export function layoutViewport(): { width: number; height: number } {
   const root = document.documentElement
   return {
      width: Math.max(1, Math.round(root.clientWidth || window.innerWidth)),
      height: Math.max(1, Math.round(root.clientHeight || window.innerHeight))
   }
}
