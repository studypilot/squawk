import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

export const TOAST_DURATION_MS = 3500

type Toast = { id: number; message: string }

type ShowToast = (message: string) => void

const ToastContext = createContext<ShowToast>(() => {})

/** `showToast("Copied")`: a short confirmation at the bottom of the screen. */
export function useToast(): ShowToast {
   return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
   const [toasts, setToasts] = useState<Toast[]>([])
   const nextId = useRef(0)
   const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

   const dismiss = useCallback((id: number) => {
      const timer = timers.current.get(id)
      if (timer !== undefined) {
         clearTimeout(timer)
         timers.current.delete(id)
      }
      setToasts(current => current.filter(toast => toast.id !== id))
   }, [])

   const show = useCallback<ShowToast>(
      message => {
         const id = (nextId.current += 1)
         setToasts(current => [...current.slice(-2), { id, message }])
         timers.current.set(
            id,
            setTimeout(() => dismiss(id), TOAST_DURATION_MS)
         )
      },
      [dismiss]
   )

   useEffect(() => {
      const pending = timers.current
      return () => {
         for (const timer of pending.values()) {
            clearTimeout(timer)
         }
      }
   }, [])

   const value = useMemo(() => show, [show])

   return (
      <ToastContext.Provider value={value}>
         {children}
         <div className="toast-region" role="status" aria-live="polite">
            {toasts.map(toast => (
               <div key={toast.id} className="toast" onClick={() => dismiss(toast.id)}>
                  {toast.message}
               </div>
            ))}
         </div>
      </ToastContext.Provider>
   )
}
