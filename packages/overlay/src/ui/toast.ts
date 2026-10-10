import { h } from "./dom"

const TOAST_DURATION_MS = 3000

export interface Toast {
   element: HTMLElement
   show(message: string): void
}

export function createToast(): Toast {
   const element = h("div", { class: "toast", role: "status", "aria-live": "polite" })
   let timer: ReturnType<typeof setTimeout> | undefined
   return {
      element,
      show(message) {
         element.textContent = message
         element.classList.add("is-visible")
         clearTimeout(timer)
         timer = setTimeout(() => element.classList.remove("is-visible"), TOAST_DURATION_MS)
      }
   }
}
