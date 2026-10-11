import type { OverlayState } from "../state"
import { h, icon, planeMark } from "./dom"

export interface LauncherHandlers {
   togglePanel(): void
   togglePinMode(): void
}

export interface Launcher {
   element: HTMLElement
   render(state: OverlayState): void
}

/** Floating pill: plane mark, the panel button with the open count, and the pin-mode button. */
export function createLauncher(handlers: LauncherHandlers): Launcher {
   const badge = h("span", { class: "badge", hidden: true })
   const pinButton = h(
      "button",
      { class: "pin-button", type: "button", onclick: () => handlers.togglePinMode() },
      [icon("plus")]
   )
   const panelButton = h(
      "button",
      {
         class: "launcher",
         type: "button",
         title: "Squawks",
         "aria-label": "Squawks",
         onclick: () => handlers.togglePanel()
      },
      [icon("comment"), badge]
   )
   const pill = h("div", { class: "launcher-pill" }, [
      h("span", { class: "launcher-mark" }, [planeMark(18)]),
      panelButton,
      h("span", { class: "launcher-divider" }),
      pinButton
   ])
   const element = h("div", { class: "launcher-group" }, [pill])

   return {
      element,
      render(state) {
         const pinning = state.mode === "pin"
         element.hidden = state.panel !== "closed" || state.mode === "busy"
         element.classList.toggle("is-pin", pinning)
         pinButton.replaceChildren(icon(pinning ? "close" : "plus"))
         const pinLabel = pinning ? "Cancel pinning" : "New squawk (C)"
         pinButton.title = pinLabel
         pinButton.setAttribute("aria-label", pinLabel)
         const openCount = state.squawks.filter(
            squawk => squawk.status === "open" && squawk.page === state.pageKey
         ).length
         badge.hidden = openCount === 0
         badge.textContent = openCount > 99 ? "99+" : String(openCount)
      }
   }
}
