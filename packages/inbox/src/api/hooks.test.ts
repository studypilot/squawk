import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POLL_INTERVAL_MS, usePagedQuery, useQuery } from "./hooks"

function setVisibility(state: DocumentVisibilityState): void {
   Object.defineProperty(document, "visibilityState", { value: state, configurable: true })
   document.dispatchEvent(new Event("visibilitychange"))
}

async function advance(ms: number): Promise<void> {
   await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
   })
}

beforeEach(() => {
   vi.useFakeTimers()
   setVisibility("visible")
})

afterEach(() => {
   vi.useRealTimers()
})

describe("useQuery polling", () => {
   it("refetches every ten seconds without showing a loading state", async () => {
      let version = 0
      const load = vi.fn(async () => ({ version: (version += 1) }))
      const { result } = renderHook(() => useQuery("me", load))
      await advance(0)
      expect(result.current).toMatchObject({ data: { version: 1 }, loading: false })

      await advance(POLL_INTERVAL_MS - 1)
      expect(load).toHaveBeenCalledTimes(1)
      await advance(1)
      expect(load).toHaveBeenCalledTimes(2)
      expect(result.current).toMatchObject({ data: { version: 2 }, loading: false })

      await advance(POLL_INTERVAL_MS)
      expect(result.current.data).toEqual({ version: 3 })
   })

   it("keeps the shown data when a poll fails", async () => {
      const load = vi
         .fn<() => Promise<string>>()
         .mockResolvedValueOnce("fresh")
         .mockRejectedValueOnce(new Error("offline"))
      const { result } = renderHook(() => useQuery("me", load))
      await advance(POLL_INTERVAL_MS)
      expect(load).toHaveBeenCalledTimes(2)
      expect(result.current).toMatchObject({ data: "fresh", error: undefined, loading: false })
   })

   it("pauses while the tab is hidden and refetches at once when it is visible again", async () => {
      const load = vi.fn(async () => "data")
      renderHook(() => useQuery("me", load))
      await advance(0)
      await act(async () => setVisibility("hidden"))

      await advance(POLL_INTERVAL_MS * 3)
      expect(load).toHaveBeenCalledTimes(1)

      await act(async () => setVisibility("visible"))
      expect(load).toHaveBeenCalledTimes(2)
      await advance(POLL_INTERVAL_MS)
      expect(load).toHaveBeenCalledTimes(3)
   })

   it("does not poll a disabled query and stops after unmount", async () => {
      const load = vi.fn(async () => "data")
      const disabled = renderHook(() => useQuery(null, load))
      await advance(POLL_INTERVAL_MS * 2)
      expect(load).not.toHaveBeenCalled()
      disabled.unmount()

      const enabled = renderHook(() => useQuery("me", load))
      await advance(0)
      enabled.unmount()
      await advance(POLL_INTERVAL_MS * 2)
      expect(load).toHaveBeenCalledTimes(1)
   })
})

describe("usePagedQuery polling", () => {
   it("re-reads the loaded pages and keeps the pagination cursor", async () => {
      let round = 0
      const loadPage = vi.fn(async (cursor: string | null) => {
         if (cursor === null) {
            return { items: [`a${round}`], nextCursor: "c1" }
         }
         return { items: [`b${round}`], nextCursor: "c2" }
      })
      const { result } = renderHook(() => usePagedQuery("site", loadPage))
      await advance(0)
      await act(async () => result.current.loadMore())
      await advance(0)
      expect(result.current).toMatchObject({ items: ["a0", "b0"], hasMore: true })

      round = 1
      await advance(POLL_INTERVAL_MS)
      expect(loadPage.mock.calls.slice(2).map(([cursor]) => cursor)).toEqual([null, "c1"])
      expect(result.current).toMatchObject({
         items: ["a1", "b1"],
         hasMore: true,
         loading: false
      })
   })
})
