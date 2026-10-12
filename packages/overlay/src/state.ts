import type { MeResponse, Squawk, SquawkDetail, SquawkMeta } from "@squawk/shared"
import type { LoginState } from "./auth"

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

/** `thread` shows the open thread inside the panel; otherwise it floats next to its pin. */
export type PanelView = "closed" | "list" | "thread"
/** `unread` lists unread squawks of either status; drafts always live in the review block. */
export type ListFilter = "open" | "resolved" | "unread"
export type Mode = "idle" | "pin" | "busy"

export interface OverlayState {
   siteKey: string
   pageKey: string
   /** Set once `Squawk.setPage()` was called; disables automatic page tracking. */
   pageKeyOverridden: boolean
   meta: SquawkMeta
   token: string | null
   /** Every open and resolved squawk of the site; never drafts. */
   squawks: Squawk[]
   /** The signed-in user's own drafts on this site, not yet submitted. */
   drafts: Squawk[]
   /** Who is signed in and with which token; null until `/me` answered. */
   me: MeResponse | null
   panel: PanelView
   /** The open thread: in the panel when `panel` is `thread`, otherwise next to its pin. */
   threadId: string | null
   /** Loaded detail of `threadId`; null while loading. */
   thread: SquawkDetail | null
   /** Progress of a running sign-in, through the popup or with a device code. */
   login: LoginState | null
   filter: ListFilter
   mode: Mode
   extensionAvailable: boolean
}

/** Newest activity first. */
function byLastActivity(first: Squawk, second: Squawk): number {
   return second.lastActivityAt.localeCompare(first.lastActivityAt)
}

/**
 * Whether a squawk belongs to the selected filter. Opening a thread marks it read right away, so
 * the open thread stays in the Unread list until it is closed; otherwise its row would vanish
 * under the pointer and `j`/`k` would lose their place.
 */
export function matchesFilter(state: OverlayState, squawk: Squawk): boolean {
   if (state.filter !== "unread") return squawk.status === state.filter
   return squawk.status !== "draft" && (squawk.unread || squawk.id === state.threadId)
}

/**
 * The squawks of the selected filter grouped by page, the current page first. This is the order
 * of the list and of keyboard navigation.
 */
export function groupByPage(state: OverlayState): [page: string, squawks: Squawk[]][] {
   const groups = new Map<string, Squawk[]>([[state.pageKey, []]])
   const visible = state.squawks.filter(squawk => matchesFilter(state, squawk)).sort(byLastActivity)
   for (const squawk of visible) {
      const group = groups.get(squawk.page) ?? []
      group.push(squawk)
      groups.set(squawk.page, group)
   }
   return [...groups].filter(([, squawks]) => squawks.length > 0)
}

export function findSquawk(state: OverlayState, squawkId: string): Squawk | undefined {
   return (
      state.squawks.find(squawk => squawk.id === squawkId) ??
      state.drafts.find(squawk => squawk.id === squawkId)
   )
}
