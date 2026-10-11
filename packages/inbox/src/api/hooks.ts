import { useCallback, useEffect, useRef, useState } from "react"

export const POLL_INTERVAL_MS = 10_000

export interface QueryResult<T> {
   data: T | undefined
   error: Error | undefined
   loading: boolean
   reload: () => void
   setData: (update: (current: T) => T) => void
}

interface QueryState<T> {
   key: string | null
   data?: T
   error?: Error
   loading: boolean
}

function toError(value: unknown): Error {
   return value instanceof Error ? value : new Error(String(value))
}

function useLatest<T>(value: T): { readonly current: T } {
   const reference = useRef(value)
   useEffect(() => {
      reference.current = value
   })
   return reference
}

/**
 * Runs `refresh` every ten seconds while the tab is visible and once more as soon as it becomes
 * visible again. Starts over whenever `key` changes; a `null` key disables polling.
 */
function usePolling(key: string | null, refresh: () => Promise<void>): void {
   const latestRefresh = useLatest(refresh)

   useEffect(() => {
      if (key === null) {
         return
      }
      let active = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = (): void => {
         clearTimeout(timer)
         timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
      const tick = async (): Promise<void> => {
         if (!active) {
            return
         }
         if (document.visibilityState === "visible") {
            await latestRefresh.current()
         }
         if (active) {
            schedule()
         }
      }
      const onVisibilityChange = (): void => {
         if (document.visibilityState === "visible") {
            void tick()
         }
      }
      document.addEventListener("visibilitychange", onVisibilityChange)
      schedule()
      return () => {
         active = false
         clearTimeout(timer)
         document.removeEventListener("visibilitychange", onVisibilityChange)
      }
   }, [key, latestRefresh])
}

/**
 * Loads data for `key` and reloads whenever the key changes, then keeps it fresh by polling.
 * A `null` key disables loading. Data from a previous key is never shown for the current one.
 */
export function useQuery<T>(key: string | null, load: () => Promise<T>): QueryResult<T> {
   const latestLoad = useLatest(load)
   const [state, setState] = useState<QueryState<T>>({ key, loading: key !== null })
   const [generation, setGeneration] = useState(0)

   useEffect(() => {
      if (key === null) {
         return
      }
      let cancelled = false
      setState(current =>
         current.key === key
            ? { ...current, loading: true, error: undefined }
            : { key, loading: true }
      )
      latestLoad.current().then(
         data => {
            if (!cancelled) {
               setState({ key, data, loading: false })
            }
         },
         (error: unknown) => {
            if (!cancelled) {
               setState({ key, error: toError(error), loading: false })
            }
         }
      )
      return () => {
         cancelled = true
      }
   }, [key, generation, latestLoad])

   // Polls keep the shown data until the fresh one arrives; a failed poll changes nothing.
   usePolling(key, async () => {
      try {
         const data = await latestLoad.current()
         setState(current => (current.key === key ? { key, data, loading: false } : current))
      } catch {
         // The next poll or a manual reload tries again.
      }
   })

   const reload = useCallback(() => setGeneration(value => value + 1), [])
   const setData = useCallback((update: (current: T) => T) => {
      setState(current =>
         current.data === undefined ? current : { ...current, data: update(current.data) }
      )
   }, [])

   const isCurrent = key !== null && state.key === key
   return {
      data: isCurrent ? state.data : undefined,
      error: isCurrent ? state.error : undefined,
      loading: key !== null && (!isCurrent || state.loading),
      reload,
      setData
   }
}

export interface CursorPage<T> {
   items: T[]
   nextCursor: string | null
}

export interface PagedQueryResult<T> {
   items: T[]
   error: Error | undefined
   loading: boolean
   hasMore: boolean
   loadMore: () => void
   /** Re-reads the pages loaded so far and swaps the items in place, like a poll. */
   reload: () => void
}

interface PagedState<T> extends CursorPage<T> {
   key: string
   /** Pages fetched so far; polling re-reads exactly these. */
   pages: number
   loading: boolean
   error?: Error
}

/**
 * Cursor pagination: loads the first page for `key`, `loadMore` appends the next one. Polling
 * re-reads the pages loaded so far and swaps the items in place.
 */
export function usePagedQuery<T>(
   key: string,
   loadPage: (cursor: string | null) => Promise<CursorPage<T>>
): PagedQueryResult<T> {
   const latestLoadPage = useLatest(loadPage)
   const [state, setState] = useState<PagedState<T>>({
      key,
      items: [],
      nextCursor: null,
      pages: 0,
      loading: true
   })

   useEffect(() => {
      let cancelled = false
      setState({ key, items: [], nextCursor: null, pages: 0, loading: true })
      latestLoadPage.current(null).then(
         page => {
            if (!cancelled) {
               setState({
                  key,
                  items: page.items,
                  nextCursor: page.nextCursor,
                  pages: 1,
                  loading: false
               })
            }
         },
         (error: unknown) => {
            if (!cancelled) {
               setState({
                  key,
                  items: [],
                  nextCursor: null,
                  pages: 0,
                  loading: false,
                  error: toError(error)
               })
            }
         }
      )
      return () => {
         cancelled = true
      }
   }, [key, latestLoadPage])

   const isCurrent = state.key === key
   const cursor = isCurrent ? state.nextCursor : null
   const busy = !isCurrent || state.loading
   const loadedPages = isCurrent ? state.pages : 0

   const refreshLoadedPages = useCallback(async (): Promise<void> => {
      if (busy || loadedPages === 0) {
         return
      }
      const items: T[] = []
      let nextCursor: string | null = null
      let pages = 0
      try {
         do {
            const page: CursorPage<T> = await latestLoadPage.current(nextCursor)
            items.push(...page.items)
            nextCursor = page.nextCursor
            pages += 1
         } while (nextCursor !== null && pages < loadedPages)
      } catch {
         return
      }
      setState(current =>
         current.key !== key || current.loading
            ? current
            : { key, items, nextCursor, pages, loading: false }
      )
   }, [key, busy, loadedPages, latestLoadPage])

   usePolling(key, refreshLoadedPages)

   const reload = useCallback(() => {
      void refreshLoadedPages()
   }, [refreshLoadedPages])

   const loadMore = useCallback(() => {
      if (cursor === null || busy) {
         return
      }
      setState(current => ({ ...current, loading: true, error: undefined }))
      latestLoadPage.current(cursor).then(
         page => {
            setState(current =>
               current.key !== key
                  ? current
                  : {
                       key,
                       items: [...current.items, ...page.items],
                       nextCursor: page.nextCursor,
                       pages: current.pages + 1,
                       loading: false
                    }
            )
         },
         (error: unknown) => {
            setState(current =>
               current.key !== key ? current : { ...current, loading: false, error: toError(error) }
            )
         }
      )
   }, [key, cursor, busy, latestLoadPage])

   return {
      items: isCurrent ? state.items : [],
      error: isCurrent ? state.error : undefined,
      loading: busy,
      hasMore: cursor !== null,
      loadMore,
      reload
   }
}
