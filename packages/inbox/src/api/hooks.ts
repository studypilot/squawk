import { useCallback, useEffect, useRef, useState } from "react"

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
 * Loads data for `key` and reloads whenever the key changes. A `null` key disables loading.
 * Data from a previous key is never shown for the current one.
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
}

interface PagedState<T> extends CursorPage<T> {
   key: string
   loading: boolean
   error?: Error
}

/** Cursor pagination: loads the first page for `key`, `loadMore` appends the next one. */
export function usePagedQuery<T>(
   key: string,
   loadPage: (cursor: string | null) => Promise<CursorPage<T>>
): PagedQueryResult<T> {
   const latestLoadPage = useLatest(loadPage)
   const [state, setState] = useState<PagedState<T>>({
      key,
      items: [],
      nextCursor: null,
      loading: true
   })

   useEffect(() => {
      let cancelled = false
      setState({ key, items: [], nextCursor: null, loading: true })
      latestLoadPage.current(null).then(
         page => {
            if (!cancelled) {
               setState({ key, items: page.items, nextCursor: page.nextCursor, loading: false })
            }
         },
         (error: unknown) => {
            if (!cancelled) {
               setState({ key, items: [], nextCursor: null, loading: false, error: toError(error) })
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
      loadMore
   }
}
