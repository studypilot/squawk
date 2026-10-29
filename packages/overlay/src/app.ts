import { LIMITS } from "@squawk/shared"
import type {
   Anchor,
   AnchorBox,
   CreateSquawkInput,
   Squawk,
   SquawkMeta,
   SquawkTargetStatus
} from "@squawk/shared"
import { captureAnchor } from "./anchor/capture"
import { resolveAnchor } from "./anchor/resolve"
import { ApiError, createApiClient } from "./api"
import { readToken, runDeviceLogin, runPopupLogin, writeToken } from "./auth"
import {
   buildSquawkLink,
   derivePageKey,
   extractSquawkLinkId,
   stripSquawkLinkFromHref,
   watchLocation
} from "./page-key"
import { takeScreenshot } from "./screenshot"
import type { CapturedScreenshot } from "./screenshot"
import { createExtensionBridge } from "./screenshot/extension"
import { createStore, findSquawk, groupByPage } from "./state"
import type { OverlayState } from "./state"
import styles from "./styles.css?inline"
import { copyText } from "./ui/clipboard"
import { createComposer } from "./ui/composer"
import type { Composer, SubmitMode } from "./ui/composer"
import { plural, workingDuration } from "./ui/format"
import { createLauncher } from "./ui/launcher"
import { createPanel } from "./ui/panel"
import { createPinMode } from "./ui/pin-mode"
import { createPinsLayer } from "./ui/pins"
import { isNarrowViewport } from "./ui/placement"
import { createThreadPopover } from "./ui/popover"
import { createThreadView } from "./ui/thread"
import type { ThreadHandlers, ThreadView } from "./ui/thread"
import { createToast } from "./ui/toast"

export interface OverlayConfig {
   serverOrigin: string
   siteKey: string
   /** Fixed page key from `data-page`; null tracks the location. */
   pageKey: string | null
   /** Value of `data-ref`, sent as `meta.ref`. */
   ref: string | null
}

export interface SquawkApi {
   readonly version: string
   setPage(key: string): void
   setSite(key: string): void
   setMeta(meta: Partial<SquawkMeta>): void
   open(): void
   close(): void
   capture(): void
}

const PANEL_POLL_MS = 5_000
const BACKGROUND_POLL_MS = 60_000
const MUTATION_DEBOUNCE_MS = 250
/** How often the "working · 4 min" durations move on. */
const WORKING_TICK_MS = 30_000
/** Squawks are listed in pages of 200; five pages cover any realistic preview site. */
const LIST_PAGE_LIMIT = 200
const LIST_MAX_PAGES = 5
const FONT_LINK_ID = "squawk-inter"
/** Width of the panel on wide screens; pins and the thread popover stay left of it. */
const PANEL_WIDTH = 380

export function createOverlay(config: OverlayConfig, version: string): SquawkApi {
   const store = createStore<OverlayState>({
      siteKey: config.siteKey,
      pageKey: config.pageKey ?? derivePageKey(location),
      pageKeyOverridden: config.pageKey !== null,
      meta: config.ref ? { ref: config.ref } : {},
      token: readToken(config.serverOrigin),
      squawks: [],
      drafts: [],
      me: null,
      panel: "closed",
      threadId: null,
      thread: null,
      login: null,
      filter: "open",
      mode: "idle",
      extensionAvailable: false
   })

   const api = createApiClient({
      serverOrigin: config.serverOrigin,
      getToken: () => store.get().token,
      onUnauthorized() {
         writeToken(config.serverOrigin, null)
         store.set({ token: null, me: null, squawks: [], drafts: [], thread: null, login: null })
      }
   })

   const bridge = createExtensionBridge()
   function detectExtension(): void {
      void bridge.detect().then(available => store.set({ extensionAvailable: available }))
   }
   detectExtension()
   // The extension's content script arrives at document idle, often after this script ran.
   if (document.readyState !== "complete") {
      window.addEventListener("load", detectExtension, { once: true })
   }

   loadFont(config.serverOrigin)

   const host = document.createElement("div")
   host.id = "squawk-root"
   const hostStyle = {
      position: "fixed",
      inset: "0",
      "z-index": "2147483000",
      "pointer-events": "none",
      display: "block"
   }
   for (const [property, value] of Object.entries(hostStyle)) {
      host.style.setProperty(property, value, "important")
   }
   const shadow = host.attachShadow({ mode: "open" })
   const style = document.createElement("style")
   style.textContent = styles
   // Keystrokes in the overlay run its own shortcuts and must not trigger the page's.
   shadow.addEventListener("keydown", event => handleShortcut(event as KeyboardEvent))
   for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, event => event.stopPropagation())
   }

   const toast = createToast()
   const pins = createPinsLayer({
      select: squawkId => selectPin(squawkId),
      hover: squawkId => panel.setHoveredPin(squawkId),
      orphans: squawks => panel.setOrphans(squawks)
   })
   const pinMode = createPinMode(host, {
      pick: (element, clientX, clientY) => void compose(element, clientX, clientY),
      pickArea: (element, area) => void compose(element, area.x, area.y, area),
      cancel: () => stopPinMode()
   })
   const launcher = createLauncher({
      togglePanel: () => (store.get().panel === "closed" ? openPanel() : closePanel()),
      togglePinMode: () => (store.get().mode === "pin" ? stopPinMode() : startPinMode())
   })
   const panel = createPanel({
      close: closePanel,
      startPinMode,
      setFilter: filter => store.set({ filter }),
      openThread: squawkId => openThread(squawkId),
      hoverSquawk: squawkId => pins.highlight(squawkId),
      revealDraft: squawkId => pins.reveal(squawkId),
      signIn,
      signInWithCode,
      cancelSignIn,
      signOut,
      updateDraft,
      deleteDraft,
      submitReview
   })
   const popover = createThreadPopover(() => closeThread())
   const threadHandlers: ThreadHandlers = {
      close: () => closeThread(),
      reply,
      setStatus,
      copyLink,
      markUnread,
      clearWorking,
      loadScreenshot: path => api.fetchScreenshot(path)
   }
   shadow.append(
      style,
      pins.element,
      popover.element,
      pinMode.element,
      panel.element,
      launcher.element,
      toast.element
   )
   document.documentElement.append(host)

   // ---- rendering --------------------------------------------------------------------------

   /**
    * Open squawks, resolved ones while that list (or the unread list, for unread ones) is shown,
    * drafts, and the open thread.
    */
   function pinnedSquawks(state: OverlayState): Squawk[] {
      const listing = state.panel !== "closed"
      const shown = state.squawks.filter(
         squawk =>
            squawk.page === state.pageKey &&
            (squawk.status === "open" ||
               squawk.id === state.threadId ||
               (listing && state.filter === "resolved") ||
               (listing && state.filter === "unread" && squawk.unread))
      )
      const drafts = state.drafts.filter(draft => draft.page === state.pageKey)
      return [...shown, ...drafts]
   }

   let shownPins: Squawk[] = []
   let threadView: ThreadView | null = null

   /** The open thread lives in the panel or in the popover next to its pin. */
   function renderThread(state: OverlayState): HTMLElement | null {
      if (!state.token || !state.threadId) {
         threadView?.dispose()
         threadView = null
         popover.hide()
         return null
      }
      if (threadView?.squawkId !== state.threadId) {
         threadView?.dispose()
         threadView = createThreadView(state.threadId, threadHandlers)
      }
      const inPanel = state.panel === "thread"
      threadView.update(state, inPanel ? "panel" : "popover")
      return threadView.element
   }

   function render(state: OverlayState): void {
      const thread = renderThread(state)
      launcher.render(state)
      panel.render(state, state.panel === "thread" ? thread : null)
      pins.select(state.threadId)
      pins.element.classList.toggle("is-beside-panel", state.panel !== "closed")
      const nextPins = pinnedSquawks(state)
      const pinsChanged =
         nextPins.length !== shownPins.length ||
         nextPins.some((squawk, index) => squawk !== shownPins[index])
      if (pinsChanged) {
         shownPins = nextPins
         pins.show(nextPins)
      }
      if (thread && state.panel !== "thread") {
         const threadId = state.threadId ?? ""
         popover.show(thread, () => pins.locate(threadId), panelInset(state))
      } else {
         popover.hide()
      }
   }
   store.subscribe(render)
   render(store.get())

   function panelInset(state: OverlayState): number {
      return state.panel !== "closed" && !isNarrowViewport() ? PANEL_WIDTH : 0
   }

   // ---- data -------------------------------------------------------------------------------

   async function fetchSiteSquawks(siteKey: string): Promise<Squawk[]> {
      const squawks: Squawk[] = []
      let cursor: string | undefined
      for (let page = 0; page < LIST_MAX_PAGES; page++) {
         const result = await api.listSquawks({
            site: siteKey,
            status: "all",
            limit: LIST_PAGE_LIMIT,
            cursor
         })
         squawks.push(...result.items)
         if (!result.nextCursor) break
         cursor = result.nextCursor
      }
      return squawks
   }

   let loadedSite: string | null = null

   async function refresh(): Promise<void> {
      const { token, siteKey } = store.get()
      if (!token) return
      panel.setLoaded(loadedSite === siteKey)
      try {
         const [squawks, drafts, me] = await Promise.all([
            fetchSiteSquawks(siteKey),
            api.listSquawks({ site: siteKey, status: "draft", limit: LIST_PAGE_LIMIT }),
            // The account footer can wait; a failing /me must not hide the list.
            store.get().me ? Promise.resolve(store.get().me) : api.me().catch(() => null)
         ])
         if (store.get().siteKey !== siteKey || store.get().token !== token) return
         const current = store.get()
         // Unchanged lists keep their identity so the pins and the list do not re-render.
         store.set({
            squawks: mergeList(current.squawks, squawks),
            drafts: mergeList(current.drafts, drafts.items),
            me
         })
         loadedSite = siteKey
         panel.setLoaded(true)
         const { threadId } = store.get()
         if (threadId) await loadThread(threadId)
      } catch {
         // Polling stays quiet; a 401 already switched the panel to sign-in.
      }
   }

   async function loadThread(squawkId: string): Promise<void> {
      try {
         const detail = await api.getSquawk(squawkId)
         if (store.get().threadId !== squawkId) return
         markRead(detail)
         const current = store.get().thread
         if (current && JSON.stringify(current) === JSON.stringify(detail)) return
         store.set({ thread: detail })
      } catch (error) {
         if (!(error instanceof ApiError) || error.code !== "not_found") throw error
         if (store.get().threadId !== squawkId) return
         toast.show("This squawk no longer exists")
         closeThread()
      }
   }

   /** Updates a squawk in the list and in the open thread, e.g. after a read or a cleared claim. */
   function patchSquawk(squawkId: string, patch: Partial<Squawk>): void {
      const { squawks, thread } = store.get()
      store.set({
         squawks: squawks.map(squawk =>
            squawk.id === squawkId ? { ...squawk, ...patch } : squawk
         ),
         thread: thread?.id === squawkId ? { ...thread, ...patch } : thread
      })
   }

   let readRequest: Promise<void> = Promise.resolve()

   /**
    * An open thread is read: right after it loaded, and again whenever polling brings new
    * activity into it. The dot goes away at once; a failed request comes back with the next poll.
    */
   function markRead(detail: Squawk): void {
      const listed = store.get().squawks.find(squawk => squawk.id === detail.id)
      if (!detail.unread && !listed?.unread) return
      if (listed) patchSquawk(detail.id, { unread: false })
      readRequest = api.setRead(detail.id, true).catch(() => undefined)
   }

   /** `u` or the thread header: back to unread, and the thread closes like in Figma. */
   function markUnread(squawkId: string): void {
      if (store.get().threadId === squawkId) closeThread()
      patchSquawk(squawkId, { unread: true })
      // After a pending "read" so the server never ends up read when the user asked for unread.
      void readRequest
         .then(() => api.setRead(squawkId, false))
         .catch(() => {
            patchSquawk(squawkId, { unread: false })
            toast.show("Could not mark the squawk unread")
         })
   }

   /** Removes a stale "working" claim, e.g. of an agent that stopped without replying. */
   async function clearWorking(squawkId: string): Promise<void> {
      await api.clearWorking(squawkId)
      patchSquawk(squawkId, { working: null })
   }

   let pollTimer: ReturnType<typeof setTimeout> | undefined
   function schedulePoll(): void {
      clearTimeout(pollTimer)
      const delay = store.get().panel === "closed" ? BACKGROUND_POLL_MS : PANEL_POLL_MS
      pollTimer = setTimeout(() => {
         const poll = document.visibilityState === "visible" ? refresh() : Promise.resolve()
         void poll.finally(schedulePoll)
      }, delay)
   }

   function refreshNow(): void {
      void refresh()
      schedulePoll()
   }

   document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshNow()
   })

   // ---- panel and threads ------------------------------------------------------------------

   function openPanel(): void {
      if (store.get().mode === "pin") stopPinMode()
      if (store.get().panel === "closed") store.set({ panel: "list" })
      refreshNow()
   }

   function closePanel(): void {
      const { panel: view } = store.get()
      // A thread shown in the panel closes with it; a popover thread stays next to its pin.
      if (view === "thread") store.set({ panel: "closed", threadId: null, thread: null })
      else store.set({ panel: "closed" })
      schedulePoll()
   }

   function closeThread(): void {
      const { panel: view, threadId } = store.get()
      if (!threadId) return
      store.set({ panel: view === "thread" ? "list" : view, threadId: null, thread: null })
   }

   /**
    * Next to the pin when the squawk is pinned on this page and there is room; in the panel for
    * other pages, lost anchors and phones.
    */
   function placeInPopover(squawkId: string): boolean {
      const state = store.get()
      if (isNarrowViewport()) return false
      const squawk = findSquawk(state, squawkId)
      if (!squawk?.anchor || squawk.page !== state.pageKey) return false
      return resolveAnchor(squawk.anchor) !== null
   }

   let pendingThreadId: string | null = null
   function openThread(squawkId: string): void {
      if (store.get().mode === "pin") stopPinMode()
      if (!store.get().token) {
         pendingThreadId = squawkId
         openPanel()
         return
      }
      if (store.get().threadId === squawkId && store.get().thread) {
         if (store.get().panel !== "thread") pins.reveal(squawkId)
         return
      }
      const inPopover = placeInPopover(squawkId)
      const { panel: view } = store.get()
      store.set({
         panel: inPopover ? (view === "thread" ? "list" : view) : "thread",
         threadId: squawkId,
         thread: null
      })
      if (inPopover) pins.reveal(squawkId)
      loadThread(squawkId).catch(() => toast.show("Could not load the squawk"))
      schedulePoll()
   }

   /** A pin click toggles its thread; draft pins open their editor in the review. */
   function selectPin(squawkId: string): void {
      const state = store.get()
      if (state.drafts.some(draft => draft.id === squawkId)) {
         if (state.threadId) closeThread()
         openPanel()
         panel.editDraft(squawkId)
         return
      }
      if (state.threadId === squawkId && state.panel !== "thread") return closeThread()
      openThread(squawkId)
   }

   /** `j`/`k`: the next or previous squawk in list order, wrapping around. */
   function stepThread(direction: 1 | -1): void {
      const state = store.get()
      const order = groupByPage(state).flatMap(([, squawks]) => squawks)
      if (order.length === 0) return
      const index = order.findIndex(squawk => squawk.id === state.threadId)
      const nextIndex =
         index === -1
            ? direction === 1
               ? 0
               : order.length - 1
            : (index + direction + order.length) % order.length
      const next = order[nextIndex]
      if (next) openThread(next.id)
   }

   async function reply(squawkId: string, body: string): Promise<void> {
      await api.addComment(squawkId, body)
      await loadThread(squawkId)
      void refresh()
   }

   function replaceSquawk(updated: Squawk): void {
      store.set({
         squawks: store.get().squawks.map(squawk => (squawk.id === updated.id ? updated : squawk))
      })
   }

   async function setStatus(squawkId: string, status: SquawkTargetStatus): Promise<void> {
      const updated = await api.updateSquawk(squawkId, { status })
      replaceSquawk(updated)
      if (status === "open") {
         if (store.get().threadId === squawkId) await loadThread(squawkId)
         toast.show(`Squawk #${updated.number} reopened`)
         return
      }
      // A resolved squawk leaves the open list; its popover goes with it, the panel keeps it.
      if (store.get().threadId === squawkId) {
         if (store.get().panel === "thread") await loadThread(squawkId)
         else closeThread()
      }
      toast.show(`Squawk #${updated.number} resolved`, {
         label: "Undo",
         run: () => {
            api.updateSquawk(squawkId, { status: "open" }).then(
               reopened => {
                  replaceSquawk(reopened)
                  if (store.get().threadId === squawkId) void loadThread(squawkId)
               },
               () => toast.show("Could not reopen the squawk")
            )
         }
      })
   }

   /** `r`: resolves the open thread. */
   function resolveOpenThread(): void {
      const { thread } = store.get()
      if (!thread || thread.status !== "open") return
      setStatus(thread.id, "resolved").catch(() => toast.show("Could not resolve the squawk"))
   }

   function copyLink(squawk: Squawk): void {
      const pageUrl =
         squawk.page !== store.get().pageKey && squawk.meta.url ? squawk.meta.url : location.href
      const link = buildSquawkLink(pageUrl, squawk.id)
      void copyText(link, shadow).then(copied =>
         toast.show(copied ? "Link copied" : "Copying failed")
      )
   }

   // ---- review (drafts) --------------------------------------------------------------------

   async function updateDraft(squawkId: string, body: string): Promise<void> {
      const updated = await api.updateSquawk(squawkId, { body })
      store.set({
         drafts: store.get().drafts.map(draft => (draft.id === updated.id ? updated : draft))
      })
   }

   async function deleteDraft(squawkId: string): Promise<void> {
      await api.deleteSquawk(squawkId)
      store.set({ drafts: store.get().drafts.filter(draft => draft.id !== squawkId) })
      toast.show("Draft deleted")
   }

   async function submitReview(): Promise<void> {
      const ids = store.get().drafts.map(draft => draft.id)
      if (ids.length === 0) return
      const submitted = await api.submitSquawks(ids)
      const submittedIds = new Set(submitted.map(squawk => squawk.id))
      const { squawks, drafts } = store.get()
      store.set({
         drafts: drafts.filter(draft => !submittedIds.has(draft.id)),
         squawks: [...submitted, ...squawks.filter(squawk => !submittedIds.has(squawk.id))],
         filter: "open"
      })
      toast.show(`${plural(submitted.length, "squawk")} sent`)
   }

   // ---- sign-in ----------------------------------------------------------------------------

   let stopLogin: (() => void) | null = null

   function acceptToken(token: string): void {
      writeToken(config.serverOrigin, token)
      store.set({ token, me: null, login: null })
      refreshNow()
      if (pendingThreadId) openThread(pendingThreadId)
      pendingThreadId = null
   }

   /** Popup on the server first; it must open within the click. Blocked popups use a code. */
   function signIn(): void {
      stopLogin?.()
      stopLogin = runPopupLogin({
         serverOrigin: config.serverOrigin,
         pageOrigin: location.origin,
         onState: login => store.set({ login }),
         onToken: acceptToken
      })
      if (!stopLogin) signInWithCode()
   }

   /** Device-code login, also for embedded web views where popups never open. */
   function signInWithCode(): void {
      stopLogin?.()
      stopLogin = runDeviceLogin({
         api,
         label: location.origin,
         onState: login => store.set({ login }),
         onToken: acceptToken
      })
   }

   function cancelSignIn(): void {
      stopLogin?.()
      stopLogin = null
      store.set({ login: null })
   }

   /** Revokes the overlay's token on the server (best effort) and forgets it here. */
   function signOut(): void {
      const tokenId = store.get().me?.token?.id
      if (tokenId) api.revokeToken(tokenId).catch(() => undefined)
      writeToken(config.serverOrigin, null)
      loadedSite = null
      store.set({
         token: null,
         me: null,
         squawks: [],
         drafts: [],
         threadId: null,
         thread: null,
         panel: store.get().panel === "closed" ? "closed" : "list"
      })
   }

   // ---- pin mode and composing -------------------------------------------------------------

   function startPinMode(): void {
      const state = store.get()
      if (!state.token) return openPanel()
      if (state.mode !== "idle") return
      store.set({ mode: "pin", panel: "closed", threadId: null, thread: null })
      pins.element.classList.add("is-passive")
      pinMode.start()
   }

   function stopPinMode(): void {
      pinMode.stop()
      pins.element.classList.remove("is-passive")
      if (store.get().mode === "pin") store.set({ mode: "idle" })
   }

   let composer: Composer | null = null

   async function compose(
      element: Element,
      clientX: number,
      clientY: number,
      area?: AnchorBox
   ): Promise<void> {
      stopPinMode()
      store.set({ mode: "busy" })
      const { siteKey, pageKey } = store.get()
      const anchor = captureAnchor(element, clientX, clientY, area)
      // Page facts belong to the moment of the click, not to the send: by then the composer
      // has focus and on iOS the keyboard and focus zoom have shrunk the visible viewport.
      const meta = captureMeta(store.get().meta, anchor.viewport)
      const screenshot = await takeScreenshot(bridge, host)
      const card = createComposer({
         anchor,
         screenshot,
         submit: (body, mode) => submit({ siteKey, pageKey, body, anchor, meta }, screenshot, mode),
         close() {
            card.element.remove()
            composer = null
            if (screenshot) URL.revokeObjectURL(screenshot.previewUrl)
            if (store.get().mode === "busy") store.set({ mode: "idle" })
         }
      })
      composer = card
      shadow.insertBefore(card.element, toast.element)
   }

   async function submit(
      draft: { siteKey: string; pageKey: string; body: string; anchor: Anchor; meta: SquawkMeta },
      screenshot: CapturedScreenshot | null,
      mode: SubmitMode
   ): Promise<void> {
      const input: CreateSquawkInput = {
         siteKey: draft.siteKey,
         page: draft.pageKey,
         body: draft.body,
         // Drafts are created right away so the screenshot is safe on the server.
         draft: mode === "draft",
         anchor: draft.anchor,
         meta: draft.meta,
         ...(screenshot
            ? {
                 screenshot: {
                    width: screenshot.width,
                    height: screenshot.height,
                    devicePixelRatio: screenshot.devicePixelRatio,
                    source: screenshot.source
                 }
              }
            : {})
      }
      const created = await api.createSquawk(input, screenshot?.blob ?? null)
      if (created.status === "draft") {
         const drafts = [...store.get().drafts.filter(squawk => squawk.id !== created.id), created]
         store.set({ drafts })
         toast.show(`Added to your review · ${plural(drafts.length, "draft")}`, {
            label: "Review",
            run: openPanel
         })
         return
      }
      store.set({
         squawks: [created, ...store.get().squawks.filter(squawk => squawk.id !== created.id)]
      })
      toast.show(`Squawk #${created.number} sent`, {
         label: "View",
         run: () => openThread(created.id)
      })
   }

   // ---- keyboard ---------------------------------------------------------------------------

   /**
    * Shortcuts, from the page and from inside the overlay: `c` new squawk, `j`/`k` (or `]`/`[`)
    * next/previous squawk, `r` resolve, `u` mark unread, `Esc` closes the innermost thing.
    */
   function handleShortcut(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.composedPath()[0]
      const inOverlay = event.composedPath().includes(host)
      if (event.key === "Escape") return handleEscape(event, target, inOverlay)
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isEditable(target) || store.get().mode !== "idle") return
      const handled = runShortcut(event.key)
      if (handled) event.preventDefault()
   }

   function runShortcut(key: string): boolean {
      const signedIn = Boolean(store.get().token)
      switch (key) {
         case "c":
            startPinMode()
            return true
         case "j":
         case "]":
            if (signedIn) stepThread(1)
            return signedIn
         case "k":
         case "[":
            if (signedIn) stepThread(-1)
            return signedIn
         case "r":
            if (!store.get().thread) return false
            resolveOpenThread()
            return true
         case "u": {
            const { thread } = store.get()
            if (!thread) return false
            markUnread(thread.id)
            return true
         }
         default:
            return false
      }
   }

   function handleEscape(
      event: KeyboardEvent,
      target: EventTarget | undefined,
      inOverlay: boolean
   ): void {
      if (isEditable(target)) {
         // The page's own fields keep their Escape; in ours it first leaves a non-empty field.
         if (!inOverlay) return
         if ((target as HTMLTextAreaElement).value?.trim()) {
            ;(target as HTMLElement).blur()
            event.preventDefault()
            return
         }
      }
      const state = store.get()
      if (composer) composer.close()
      else if (state.threadId) closeThread()
      else if (state.panel !== "closed") closePanel()
      else return
      event.preventDefault()
   }

   window.addEventListener("keydown", handleShortcut)

   setInterval(() => {
      for (const label of shadow.querySelectorAll<HTMLElement>("[data-since]")) {
         label.textContent = workingDuration(label.dataset.since ?? "")
      }
   }, WORKING_TICK_MS)

   // Clicks outside the thread popover close it, like any other popover.
   window.addEventListener(
      "pointerdown",
      event => {
         if (!popover.isOpen()) return
         const path = event.composedPath()
         const inside = [popover.element, pins.element, panel.element, toast.element].some(part =>
            path.includes(part)
         )
         if (!inside && !shadow.querySelector(".lightbox")) closeThread()
      },
      true
   )

   // ---- page tracking and DOM changes ------------------------------------------------------

   let handledLinkId: string | null = null
   function openLinkedThread(): void {
      const linkedId = extractSquawkLinkId(location.hash)
      if (!linkedId || linkedId === handledLinkId) return
      handledLinkId = linkedId
      openThread(linkedId)
   }

   watchLocation(() => {
      openLinkedThread()
      if (store.get().pageKeyOverridden) return
      const pageKey = derivePageKey(location)
      if (pageKey !== store.get().pageKey) store.set({ pageKey })
   })

   let mutationTimer: ReturnType<typeof setTimeout> | undefined
   const observer = new MutationObserver(records => {
      if (records.every(record => record.target === host)) return
      clearTimeout(mutationTimer)
      mutationTimer = setTimeout(() => {
         if (!host.isConnected) document.documentElement.append(host)
         pins.refresh()
      }, MUTATION_DEBOUNCE_MS)
   })
   observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
   })

   refreshNow()
   openLinkedThread()

   // ---- public API -------------------------------------------------------------------------

   return {
      version,
      setPage(key) {
         if (typeof key !== "string" || !key) return
         store.set({ pageKey: key.slice(0, LIMITS.pageKeyMaxLength), pageKeyOverridden: true })
      },
      setSite(key) {
         if (typeof key !== "string" || !key || key === store.get().siteKey) return
         store.set({ siteKey: key, squawks: [], drafts: [], threadId: null, thread: null })
         if (store.get().panel === "thread") store.set({ panel: "list" })
         refreshNow()
      },
      setMeta(meta) {
         const current = store.get().meta
         const extra = meta.extra ? { ...current.extra, ...meta.extra } : current.extra
         store.set({ meta: { ...current, ...meta, ...(extra ? { extra } : {}) } })
      },
      open: openPanel,
      close() {
         stopPinMode()
         closePanel()
      },
      capture: startPinMode
   }
}

/** Facts about the page at capture time; values set through `Squawk.setMeta` win. */
function captureMeta(
   declared: SquawkMeta,
   viewport: { width: number; height: number }
): SquawkMeta {
   return {
      url: stripSquawkLinkFromHref(location.href).slice(0, 4000),
      title: document.title.slice(0, 500),
      userAgent: navigator.userAgent.slice(0, 1000),
      viewport,
      devicePixelRatio: window.devicePixelRatio,
      ...declared
   }
}

function sameOrNew(previous: Squawk | undefined, next: Squawk): Squawk {
   return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next
}

/** The fresh list, reusing unchanged items and the whole previous array if nothing changed. */
function mergeList(previous: Squawk[], next: Squawk[]): Squawk[] {
   const byId = new Map(previous.map(squawk => [squawk.id, squawk]))
   const merged = next.map(squawk => sameOrNew(byId.get(squawk.id), squawk))
   const unchanged =
      merged.length === previous.length &&
      merged.every((squawk, index) => squawk === previous[index])
   return unchanged ? previous : merged
}

function isEditable(target: EventTarget | undefined): boolean {
   if (!(target instanceof HTMLElement)) return false
   if (target.isContentEditable) return true
   return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

/** Inter is served next to the inbox; the system stack stays the fallback until it arrives. */
function loadFont(serverOrigin: string): void {
   if (document.getElementById(FONT_LINK_ID)) return
   const link = document.createElement("link")
   link.id = FONT_LINK_ID
   link.rel = "stylesheet"
   // Anonymous CORS lets the DOM screenshot read the sheet's rules instead of logging errors.
   link.crossOrigin = "anonymous"
   link.href = `${serverOrigin}/fonts/inter.css`
   document.head.append(link)
}
