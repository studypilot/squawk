import { h } from "./dom"

const TOAST_DURATION_MS = 3500

export interface ToastAction {
   label: string
   run(): void
}

export interface Toast {
   element: HTMLElement
   show(message: string, action?: ToastAction): void
}

export function createToast(): Toast {
   const element = h("div", { class: "toast", role: "status", "aria-live": "polite" })
   let timer: ReturnType<typeof setTimeout> | undefined

   function hide(): void {
      element.classList.remove("is-visible")
   }

   return {
      element,
      show(message, action) {
         element.replaceChildren(h("span", {}, [message]))
         if (action) {
            element.append(
               h(
                  "button",
                  {
                     class: "toast-action",
                     type: "button",
                     onclick: () => {
                        hide()
                        action.run()
                     }
                  },
                  [action.label]
               )
            )
         }
         element.classList.add("is-visible")
         clearTimeout(timer)
         timer = setTimeout(hide, TOAST_DURATION_MS)
      }
   }
}
