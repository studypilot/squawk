import type { Squawk, SquawkDetail, SquawkMeta } from "@squawk/shared"
import type { DeviceLoginState } from "./auth"

export type Listener<State> = (state: State, previous: State) => void

export interface Store<State> {
   get(): State
   set(patch: Partial<State>): void
   subscribe(listener: Listener<State>): () => void
}

export function createStore<State extends object>(initial: State): Store<State> {
   let state = initial
   const listeners = new Set<Listener<State>>()
   return {
      get: () => state,
      set(patch) {
         const previous = state
         state = { ...state, ...patch }
         for (const listener of listeners) listener(state, previous)
      },
      subscribe(listener) {
         listeners.add(listener)
         return () => listeners.delete(listener)
      }
   }
}

export type PanelView = "closed" | "list" | "thread"
export type ListFilter = "open" | "resolved"
export type Mode = "idle" | "pin" | "busy"

export interface OverlayState {
   siteKey: string
   pageKey: string
   /** Set once `Squawk.setPage()` was called; disables automatic page tracking. */
   pageKeyOverridden: boolean
   meta: SquawkMeta
   token: string | null
   /** Every squawk of the site, both statuses. */
   squawks: Squawk[]
   panel: PanelView
   threadId: string | null
   /** Loaded detail of `threadId`; null while loading. */
   thread: SquawkDetail | null
   /** Progress of a running device-code sign-in. */
   login: DeviceLoginState | null
   filter: ListFilter
   mode: Mode
   extensionAvailable: boolean
}
