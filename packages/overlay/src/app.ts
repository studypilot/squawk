import { LIMITS } from "@squawk/shared"
import type {
   Anchor,
   Author,
   CreateSquawkInput,
   Squawk,
   SquawkMeta,
   SquawkStatus
} from "@squawk/shared"
import { captureAnchor } from "./anchor/capture"
import { resolveAnchor } from "./anchor/resolve"
import { ApiError, createApiClient } from "./api"
import { readToken, runDeviceLogin, writeToken } from "./auth"
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
import { createStore } from "./state"
import type { OverlayState } from "./state"
import styles from "./styles.css?inline"
import { copyText } from "./ui/clipboard"
import { createComposer } from "./ui/composer"
import { createLauncher } from "./ui/launcher"
import { createPanel } from "./ui/panel"
import { createPinMode } from "./ui/pin-mode"
import { createPinsLayer } from "./ui/pins"
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
/** Squawks are listed in pages of 200; five pages cover any realistic preview site. */
const LIST_PAGE_LIMIT = 200
const LIST_MAX_PAGES = 5
const FONT_LINK_ID = "squawk-inter"

export function createOverlay(config: OverlayConfig, version: string): SquawkApi {
   const store = createStore<OverlayState>({
      siteKey: config.siteKey,
      pageKey: config.pageKey ?? derivePageKey(location),
      pageKeyOverridden: config.pageKey !== null,
      meta: config.ref ? { ref: config.ref } : {},
      token: readToken(config.serverOrigin),
      squawks: [],
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
         store.set({ token: null, squawks: [], thread: null, login: null })
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
   // Keystrokes in our fields must not trigger the page's shortcuts.
   for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, event => event.stopPropagation())
   }

   const toast = createToast()
   const pins = createPinsLayer({
      select: squawkId => openThread(squawkId),
      hover: squawkId => panel.setHoveredPin(squawkId),
      orphans: squawks => panel.setOrphans(squawks)
   })
   const pinMode = createPinMode(host, {
      pick: (element, clientX, clientY) => void compose(element, clientX, clientY),
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
      openThread,
      showList: () => store.set({ panel: "list", threadId: null, thread: null }),
      signIn,
      cancelSignIn,
      reply,
      setStatus,
      copyLink,
      loadScreenshot: path => api.fetchScreenshot(path)
   })
   shadow.append(
      style,
      pins.element,
      pinMode.element,
      panel.element,
      launcher.element,
      toast.element
   )
   document.documentElement.append(host)

   // ---- rendering --------------------------------------------------------------------------

   function pinnedSquawks(state: OverlayState): Squawk[] {
      const showResolved = state.panel !== "closed" && state.filter === "resolved"
      return state.squawks.filter(
         squawk => squawk.page === state.pageKey && (squawk.status === "open" || showResolved)
      )
   }

   let shownPins: Squawk[] = []
   function render(state: OverlayState): void {
      launcher.render(state)
      panel.render(state)
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
   }
   store.subscribe(render)
   render(store.get())

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
   let currentUser: Author | null = null

   async function refresh(): Promise<void> {
      const { token, siteKey } = store.get()
      if (!token) return
      panel.setLoaded(loadedSite === siteKey)
      try {
         const squawks = await fetchSiteSquawks(siteKey)
         if (store.get().siteKey !== siteKey || store.get().token !== token) return
         // Keep unchanged items identical so the pins and the list do not re-render needlessly.
         const previous = new Map(store.get().squawks.map(squawk => [squawk.id, squawk]))
         store.set({ squawks: squawks.map(squawk => sameOrNew(previous.get(squawk.id), squawk)) })
         loadedSite = siteKey
         panel.setLoaded(true)
         const { panel: view, threadId } = store.get()
         if (view === "thread" && threadId) await loadThread(threadId)
         if (!currentUser) currentUser = (await api.me()).principal
      } catch {
         // Polling stays quiet; a 401 already switched the panel to sign-in.
      }
   }

   async function loadThread(squawkId: string): Promise<void> {
      try {
         const detail = await api.getSquawk(squawkId)
         if (store.get().threadId !== squawkId) return
         const current = store.get().thread
         if (current && JSON.stringify(current) === JSON.stringify(detail)) return
         store.set({ thread: detail })
      } catch (error) {
         if (!(error instanceof ApiError) || error.code !== "not_found") throw error
         if (store.get().threadId !== squawkId) return
         toast.show("This squawk no longer exists")
         store.set({ panel: "list", threadId: null, thread: null })
      }
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
      store.set({ panel: "closed", threadId: null, thread: null })
      schedulePoll()
   }

   let pendingThreadId: string | null = null
   function openThread(squawkId: string): void {
      if (store.get().mode === "pin") stopPinMode()
      if (!store.get().token) {
         pendingThreadId = squawkId
         openPanel()
         return
      }
      store.set({ panel: "thread", threadId: squawkId, thread: null })
      loadThread(squawkId).then(
         () => scrollToPin(squawkId),
         () => toast.show("Could not load the squawk")
      )
      schedulePoll()
   }

   function scrollToPin(squawkId: string): void {
      const { thread, pageKey } = store.get()
      if (thread?.id !== squawkId || !thread.anchor || thread.page !== pageKey) return
      resolveAnchor(thread.anchor)?.element.scrollIntoView({ block: "center", behavior: "smooth" })
   }

   async function reply(squawkId: string, body: string): Promise<void> {
      await api.addComment(squawkId, body)
      await loadThread(squawkId)
      void refresh()
   }

   async function setStatus(squawkId: string, status: SquawkStatus): Promise<void> {
      const updated = await api.setStatus(squawkId, status)
      store.set({
         squawks: store.get().squawks.map(squawk => (squawk.id === updated.id ? updated : squawk))
      })
      await loadThread(squawkId)
      toast.show(status === "resolved" ? `Squawk #${updated.number} resolved` : "Squawk reopened")
   }

   function copyLink(squawk: Squawk): void {
      const pageUrl =
         squawk.page !== store.get().pageKey && squawk.meta.url ? squawk.meta.url : location.href
      const link = buildSquawkLink(pageUrl, squawk.id)
      void copyText(link, shadow).then(copied =>
         toast.show(copied ? "Link copied" : "Copying failed")
      )
   }

   // ---- sign-in ----------------------------------------------------------------------------

   let stopLogin: (() => void) | null = null
   function signIn(): void {
      stopLogin?.()
      stopLogin = runDeviceLogin({
         api,
         label: location.origin,
         onState: login => store.set({ login }),
         onToken(token) {
            writeToken(config.serverOrigin, token)
            currentUser = null
            store.set({ token, login: null })
            refreshNow()
            if (pendingThreadId) openThread(pendingThreadId)
            pendingThreadId = null
         }
      })
   }

   function cancelSignIn(): void {
      stopLogin?.()
      stopLogin = null
      store.set({ login: null })
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

   async function compose(element: Element, clientX: number, clientY: number): Promise<void> {
      stopPinMode()
      store.set({ mode: "busy" })
      const { siteKey, pageKey } = store.get()
      const anchor = captureAnchor(element, clientX, clientY)
      // Page facts belong to the moment of the click, not to the send: by then the composer
      // has focus and on iOS the keyboard and focus zoom have shrunk the visible viewport.
      const meta = captureMeta(store.get().meta, anchor.viewport)
      const screenshot = await takeScreenshot(bridge, host)
      const card = createComposer({
         anchor,
         screenshot,
         user: currentUser,
         submit: body => submit({ siteKey, pageKey, body, anchor, meta }, screenshot),
         close() {
            card.remove()
            if (screenshot) URL.revokeObjectURL(screenshot.previewUrl)
            if (store.get().mode === "busy") store.set({ mode: "idle" })
         }
      })
      shadow.insertBefore(card, toast.element)
   }

   async function submit(
      draft: { siteKey: string; pageKey: string; body: string; anchor: Anchor; meta: SquawkMeta },
      screenshot: CapturedScreenshot | null
   ): Promise<void> {
      const input: CreateSquawkInput = {
         siteKey: draft.siteKey,
         page: draft.pageKey,
         body: draft.body,
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
      store.set({
         squawks: [created, ...store.get().squawks.filter(squawk => squawk.id !== created.id)]
      })
      toast.show(`Squawk #${created.number} filed`, {
         label: "View",
         run: () => openThread(created.id)
      })
   }

   window.addEventListener("keydown", event => {
      if (event.key !== "c" || event.repeat || event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditable(event.composedPath()[0])) return
      if (store.get().mode !== "idle") return
      startPinMode()
   })

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
         store.set({ siteKey: key, squawks: [], threadId: null, thread: null })
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
