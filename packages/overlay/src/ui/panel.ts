import { LIMITS } from "@squawk/shared"
import type { Author, Squawk, SquawkDetail, SquawkStatus } from "@squawk/shared"
import type { DeviceLoginState } from "../auth"
import type { ListFilter, OverlayState } from "../state"
import { copyText } from "./clipboard"
import { autoGrow, avatar, h, icon, planeMark } from "./dom"
import type { IconName } from "./dom"
import { authorName, firstLine, relativeTime, renderBody } from "./format"

export interface PanelHandlers {
   close(): void
   startPinMode(): void
   setFilter(filter: ListFilter): void
   openThread(squawkId: string): void
   showList(): void
   signIn(): void
   cancelSignIn(): void
   reply(squawkId: string, body: string): Promise<void>
   setStatus(squawkId: string, status: SquawkStatus): Promise<void>
   copyLink(squawk: Squawk): void
   loadScreenshot(path: string): Promise<Blob>
}

export interface Panel {
   element: HTMLElement
   render(state: OverlayState): void
   /** Shows skeleton rows until the first list of the site has arrived. */
   setLoaded(loaded: boolean): void
   /** Squawks of this page whose pin could not be placed; shown in the tray. */
   setOrphans(squawks: Squawk[]): void
   /** Marks the list row whose page pin is under the pointer. */
   setHoveredPin(squawkId: string | null): void
}

const RENDER_KEYS = [
   "panel",
   "token",
   "login",
   "squawks",
   "filter",
   "threadId",
   "thread",
   "siteKey",
   "pageKey"
] as const satisfies readonly (keyof OverlayState)[]

const SKELETON_ROWS = 4
const COPIED_FEEDBACK_MS = 1200

/** Slide-over on the right: sign-in, the squawk list, or one thread. */
export function createPanel(handlers: PanelHandlers): Panel {
   const siteLabel = h("code", { class: "site chip mono" })
   const pageLabel = h("div", { class: "page" })
   const newButton = h(
      "button",
      {
         class: "button primary small",
         type: "button",
         title: "New squawk (C)",
         "aria-label": "New squawk (C)",
         onclick: () => handlers.startPinMode()
      },
      [icon("plus", 14), "New"]
   )
   const header = h("div", { class: "panel-header" }, [
      h("div", { class: "panel-brand" }, [
         planeMark(18),
         h("span", { class: "wordmark" }, ["Squawk"]),
         newButton,
         iconButton("close", "Close", () => handlers.close())
      ]),
      h("div", { class: "panel-keys" }, [siteLabel, pageLabel])
   ])
   const tray = h("div", { class: "orphan-tray", hidden: true })
   const body = h("div", { class: "panel-body" })
   const element = h("aside", { class: "panel", "aria-label": "Squawks" }, [header, tray, body])
   let previous: OverlayState | null = null
   let bodyKey = ""
   let threadView: ThreadView | null = null
   let loaded = false
   let hoveredPinId: string | null = null

   function showBody(key: string, content: Node): void {
      const scrollTop = key === bodyKey ? body.scrollTop : 0
      if (key !== bodyKey || body.firstChild !== content) body.replaceChildren(content)
      body.scrollTop = scrollTop
      bodyKey = key
   }

   function disposeThreadView(): void {
      threadView?.dispose()
      threadView = null
   }

   function applyHoveredPin(): void {
      for (const row of body.querySelectorAll<HTMLElement>(".item")) {
         row.classList.toggle("is-active", row.dataset.id === hoveredPinId)
      }
   }

   function render(state: OverlayState): void {
      element.classList.toggle("is-open", state.panel !== "closed")
      if (state.panel === "closed") {
         disposeThreadView()
         bodyKey = ""
         return
      }
      siteLabel.textContent = state.siteKey
      siteLabel.title = state.siteKey
      pageLabel.textContent = state.pageKey
      pageLabel.title = state.pageKey
      newButton.hidden = !state.token
      tray.hidden = !state.token || state.panel !== "list" || tray.childElementCount === 0
      if (!state.token) {
         disposeThreadView()
         return showBody("sign-in", signInView(state.login, handlers))
      }
      if (state.panel === "thread" && state.threadId) {
         if (threadView?.squawkId !== state.threadId) {
            disposeThreadView()
            threadView = createThreadView(state.threadId, handlers)
         }
         threadView.update(state)
         return showBody(`thread:${state.threadId}`, threadView.element)
      }
      disposeThreadView()
      showBody("list", listView(state, loaded, handlers))
      applyHoveredPin()
   }

   return {
      element,
      render(state) {
         const changed = !previous || RENDER_KEYS.some(key => previous?.[key] !== state[key])
         previous = state
         if (changed) render(state)
      },
      setLoaded(next) {
         if (loaded === next) return
         loaded = next
         if (previous && bodyKey === "list") render(previous)
      },
      setOrphans(squawks) {
         tray.replaceChildren()
         if (squawks.length > 0) {
            tray.append(
               h("span", { class: "label" }, [`${squawks.length} not on this view`]),
               ...squawks.map(squawk =>
                  h(
                     "button",
                     {
                        class: `pin${squawk.status === "resolved" ? " is-resolved" : ""}`,
                        type: "button",
                        title: `#${squawk.number}: ${firstLine(squawk.body)}`,
                        onclick: () => handlers.openThread(squawk.id)
                     },
                     [h("span", {}, [String(squawk.number)])]
                  )
               )
            )
         }
         tray.hidden = squawks.length === 0 || !previous?.token || previous.panel !== "list"
      },
      setHoveredPin(squawkId) {
         hoveredPinId = squawkId
         applyHoveredPin()
      }
   }
}

function iconButton(name: IconName, label: string, onclick: () => void): HTMLButtonElement {
   return h(
      "button",
      { class: "icon-button", type: "button", title: label, "aria-label": label, onclick },
      [icon(name)]
   )
}

// ---- sign-in -------------------------------------------------------------------------------

function signInView(login: DeviceLoginState | null, handlers: PanelHandlers): HTMLElement {
   const signInButton = h(
      "button",
      { class: "button primary", type: "button", onclick: () => handlers.signIn() },
      [login ? "Try again" : "Sign in"]
   )
   const view = h("div", { class: "sign-in" }, [
      planeMark(28),
      h("div", { class: "title" }, ["Sign in to Squawk"])
   ])
   if (!login) {
      view.append(
         h("p", { class: "muted" }, ["See and add squawks on this page with your team account."]),
         signInButton
      )
      return view
   }
   switch (login.status) {
      case "starting":
         view.append(h("p", { class: "waiting" }, ["Requesting a sign-in code…"]))
         break
      case "waiting":
         view.append(
            h("p", { class: "muted" }, ["Confirm this code on the approval page"]),
            userCode(login.userCode),
            h(
               "a",
               {
                  class: "button primary",
                  href: login.verificationUrl,
                  target: "_blank",
                  rel: "noopener"
               },
               ["Open approval page", icon("external", 14)]
            ),
            h("p", { class: "waiting" }, ["Waiting for approval…"]),
            h(
               "button",
               { class: "button ghost", type: "button", onclick: () => handlers.cancelSignIn() },
               ["Cancel"]
            )
         )
         break
      case "approved":
         view.append(h("p", { class: "muted" }, ["Signed in."]))
         break
      case "denied":
         view.append(h("p", { class: "muted" }, ["The sign-in was denied."]), signInButton)
         break
      case "expired":
         view.append(h("p", { class: "muted" }, ["The code expired."]), signInButton)
         break
      case "error":
         view.append(h("p", { class: "error" }, [login.message]), signInButton)
         break
   }
   return view
}

function userCode(code: string): HTMLElement {
   let timer: ReturnType<typeof setTimeout> | undefined
   const tile = h(
      "button",
      {
         class: "user-code",
         type: "button",
         title: "Copy code",
         "aria-label": `Code ${code}, copy`
      },
      [code]
   )
   tile.addEventListener("click", () => {
      void copyText(code, tile.getRootNode() as ParentNode).then(copied => {
         if (!copied) return
         tile.classList.add("is-copied")
         clearTimeout(timer)
         timer = setTimeout(() => tile.classList.remove("is-copied"), COPIED_FEEDBACK_MS)
      })
   })
   return tile
}

// ---- list ----------------------------------------------------------------------------------

function listView(state: OverlayState, loaded: boolean, handlers: PanelHandlers): HTMLElement {
   const counts = { open: 0, resolved: 0 }
   for (const squawk of state.squawks) counts[squawk.status]++
   const tab = (filter: ListFilter, label: string): HTMLButtonElement =>
      h(
         "button",
         {
            class: `tab${state.filter === filter ? " is-selected" : ""}`,
            type: "button",
            "aria-pressed": String(state.filter === filter),
            onclick: () => handlers.setFilter(filter)
         },
         [label, h("span", { class: "count" }, [String(counts[filter])])]
      )

   const visible = state.squawks
      .filter(squawk => squawk.status === state.filter)
      .sort((first, second) => second.number - first.number)
   const groups = new Map<string, Squawk[]>([[state.pageKey, []]])
   for (const squawk of visible) {
      const group = groups.get(squawk.page) ?? []
      group.push(squawk)
      groups.set(squawk.page, group)
   }

   const sections: HTMLElement[] = []
   for (const [page, squawks] of groups) {
      if (squawks.length === 0) continue
      const current = page === state.pageKey
      sections.push(
         h("section", {}, [
            h("h3", { class: "group-title", title: page }, [current ? "This page" : page]),
            ...squawks.map(squawk => listItem(squawk, current, handlers))
         ])
      )
   }
   const content =
      sections.length > 0
         ? sections
         : !loaded && state.squawks.length === 0
           ? skeletonRows()
           : [emptyState(state.filter)]
   return h("div", { class: "list" }, [
      h("div", { class: "tabs", role: "group", "aria-label": "Filter" }, [
         tab("open", "Open"),
         tab("resolved", "Resolved")
      ]),
      ...content
   ])
}

function listItem(squawk: Squawk, onThisPage: boolean, handlers: PanelHandlers): HTMLElement {
   const replies = squawk.commentCount
   return h(
      "button",
      {
         class: `item${squawk.status === "resolved" ? " is-resolved" : ""}`,
         type: "button",
         "data-id": squawk.id,
         onclick: () => handlers.openThread(squawk.id)
      },
      [
         avatar(squawk.author, 24),
         h("div", { class: "item-text" }, [
            h("div", { class: "item-body" }, [firstLine(squawk.body)]),
            h("div", { class: "item-meta" }, [
               h("span", { class: "number" }, [`#${squawk.number}`]),
               h("span", {}, ["·"]),
               h("span", {}, [authorName(squawk.author)]),
               h("span", {}, ["·"]),
               h("span", {}, [relativeTime(squawk.createdAt)]),
               !onThisPage && h("span", {}, ["·"]),
               !onThisPage && h("span", { class: "page-key", title: squawk.page }, [squawk.page]),
               replies > 0 && h("span", {}, ["·"]),
               replies > 0 &&
                  h("span", { class: "replies" }, [
                     icon("comment", 12),
                     String(replies),
                     h("span", { class: "sr-only" }, [replies === 1 ? " reply" : " replies"])
                  ])
            ])
         ])
      ]
   )
}

function emptyState(filter: ListFilter): HTMLElement {
   const open = filter === "open"
   return h("div", { class: "empty" }, [
      icon(open ? "comment" : "check", 24),
      h("div", { class: "title" }, [open ? "No open squawks here yet" : "Nothing resolved yet"]),
      h(
         "div",
         { class: "hint" },
         open
            ? ["Press ", h("kbd", {}, ["C"]), " or tap + to file the first one"]
            : ["Resolved squawks of this site show up here"]
      )
   ])
}

function skeletonRows(): HTMLElement[] {
   return Array.from({ length: SKELETON_ROWS }, (_, index) => {
      const title = h("div", { class: "skeleton-bar" })
      title.style.width = `${72 - (index % 3) * 14}%`
      const meta = h("div", { class: "skeleton-bar" })
      meta.style.width = "45%"
      meta.style.height = "8px"
      return h("div", { class: "skeleton", "aria-hidden": "true" }, [
         h("span", { class: "avatar" }),
         h("div", { class: "skeleton-text" }, [title, meta])
      ])
   })
}

// ---- thread --------------------------------------------------------------------------------

interface ThreadView {
   squawkId: string
   element: HTMLElement
   update(state: OverlayState): void
   dispose(): void
}

function createThreadView(squawkId: string, handlers: PanelHandlers): ThreadView {
   const title = h("span", { class: "thread-title" })
   const status = h("span", { class: "chip status" })
   const banner = h("div", { class: "thread-banner", hidden: true })
   const shot = h("div", { class: "shot", hidden: true })
   const messages = h("div", { class: "messages" }, threadSkeleton())
   const textarea = h("textarea", {
      placeholder: "Reply…",
      "aria-label": "Reply",
      maxlength: LIMITS.bodyMaxLength
   })
   autoGrow(textarea, 2, 6)
   const replyButton = h("button", { class: "button primary", type: "button" }, ["Reply"])
   const statusButton = h("button", { class: "button", type: "button" })
   const copyButton = iconButton("link", "Copy link", () => {
      if (detail) handlers.copyLink(detail)
   })
   const pageLink = h("a", { class: "button ghost", hidden: true }, [
      "Go to page",
      icon("external", 14)
   ])
   const error = h("div", { class: "error", hidden: true })
   const element = h("div", { class: "thread" }, [
      h("div", { class: "thread-header" }, [
         iconButton("back", "Back to list", () => handlers.showList()),
         title,
         status,
         h("span", { class: "spacer" }),
         copyButton
      ]),
      banner,
      shot,
      messages,
      h("div", { class: "thread-footer" }, [
         textarea,
         error,
         h("div", { class: "thread-actions" }, [
            statusButton,
            pageLink,
            h("span", { class: "spacer" }),
            replyButton
         ])
      ])
   ])
   let detail: SquawkDetail | null = null
   let screenshotUrl: string | null = null
   let disposed = false

   async function run(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
      if (button.disabled) return
      button.disabled = true
      error.hidden = true
      try {
         await action()
      } catch (failure) {
         error.textContent = failure instanceof Error ? failure.message : "Something went wrong"
         error.hidden = false
      } finally {
         button.disabled = false
      }
   }

   replyButton.addEventListener("click", () => {
      const body = textarea.value.trim()
      if (!body || !detail) return
      void run(replyButton, async () => {
         await handlers.reply(squawkId, body)
         textarea.value = ""
         textarea.dispatchEvent(new Event("input"))
      })
   })
   textarea.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) replyButton.click()
   })
   statusButton.addEventListener("click", () => {
      if (!detail) return
      const next: SquawkStatus = detail.status === "open" ? "resolved" : "open"
      void run(statusButton, () => handlers.setStatus(squawkId, next))
   })

   function openLightbox(): void {
      if (!screenshotUrl) return
      const lightbox = h("div", { class: "lightbox", role: "dialog", "aria-label": "Screenshot" })
      const close = (): void => {
         lightbox.remove()
         window.removeEventListener("keydown", onKey, true)
      }
      const onKey = (event: KeyboardEvent): void => {
         if (event.key !== "Escape") return
         event.stopPropagation()
         close()
      }
      lightbox.append(
         h("img", { src: screenshotUrl, alt: "Screenshot" }),
         iconButton("close", "Close", close)
      )
      lightbox.addEventListener("click", close)
      window.addEventListener("keydown", onKey, true)
      const root = element.getRootNode()
      ;(root instanceof ShadowRoot ? root : document.body).append(lightbox)
   }

   function loadScreenshot(next: SquawkDetail): void {
      if (!next.screenshot) return
      handlers.loadScreenshot(next.screenshot.url).then(
         blob => {
            if (disposed) return
            screenshotUrl = URL.createObjectURL(blob)
            const image = h("img", { src: screenshotUrl, alt: "Screenshot" })
            shot.replaceChildren(image, h("span", { class: "expand" }, [icon("expand", 14)]))
            const marker = screenshotMarker(next)
            if (marker) shot.append(marker)
            shot.hidden = false
         },
         () => {
            if (disposed) return
            shot.replaceChildren(h("span", { class: "muted" }, ["Screenshot unavailable."]))
            shot.hidden = false
         }
      )
   }
   shot.addEventListener("click", openLightbox)

   return {
      squawkId,
      element,
      update(state) {
         const next = state.thread?.id === squawkId ? state.thread : null
         if (!next || next === detail) return
         if (!detail) loadScreenshot(next)
         detail = next
         title.textContent = `#${next.number}`
         status.textContent = next.status === "open" ? "Open" : "Resolved"
         status.className = `chip status is-${next.status}`
         statusButton.replaceChildren(
            icon(next.status === "open" ? "check" : "reopen", 14),
            next.status === "open" ? "Resolve" : "Reopen"
         )
         banner.hidden = next.status !== "resolved"
         if (next.status === "resolved") {
            banner.replaceChildren(
               icon("check", 14),
               h("span", {}, [
                  `Resolved by ${next.resolvedBy ? authorName(next.resolvedBy) : "someone"}`
               ]),
               next.resolvedAt
                  ? h("span", { class: "muted" }, [`· ${relativeTime(next.resolvedAt)}`])
                  : ""
            )
         }
         const pageUrl = next.page !== state.pageKey ? safeHttpUrl(next.meta.url) : null
         pageLink.hidden = pageUrl === null
         if (pageUrl === null) pageLink.removeAttribute("href")
         else pageLink.setAttribute("href", pageUrl)
         messages.replaceChildren(...threadMessages(next))
      },
      dispose() {
         disposed = true
         if (screenshotUrl) URL.revokeObjectURL(screenshotUrl)
      }
   }
}

/** Marker on the stored screenshot at the pinned point; the image keeps its own aspect ratio. */
function screenshotMarker(detail: SquawkDetail): HTMLElement | null {
   const anchor = detail.anchor
   if (!anchor) return null
   const clickX = anchor.elementBox.x + anchor.rect.x * anchor.elementBox.width
   const clickY = anchor.elementBox.y + anchor.rect.y * anchor.elementBox.height
   const marker = h("span", { class: "marker" })
   marker.style.left = `${(clickX / anchor.viewport.width) * 100}%`
   marker.style.top = `${(clickY / anchor.viewport.height) * 100}%`
   return marker
}

function threadSkeleton(): HTMLElement[] {
   return Array.from({ length: 2 }, (_, index) => {
      const head = h("div", { class: "skeleton-bar" })
      head.style.width = "40%"
      head.style.height = "8px"
      const line = h("div", { class: "skeleton-bar" })
      line.style.width = index === 0 ? "90%" : "60%"
      return h("div", { class: "skeleton", "aria-hidden": "true" }, [
         h("span", { class: "avatar" }),
         h("div", { class: "skeleton-text" }, [head, line])
      ])
   })
}

/** Only http(s) URLs may become links; `meta.url` is reporter-supplied and could be anything. */
function safeHttpUrl(value: string | undefined): string | null {
   if (!value) return null
   try {
      const url = new URL(value)
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
   } catch {
      return null
   }
}

/** The squawk body followed by its replies. */
function threadMessages(detail: SquawkDetail): HTMLElement[] {
   return [
      message(detail.author, detail.createdAt, detail.body),
      ...detail.comments.map(comment => message(comment.author, comment.createdAt, comment.body))
   ]
}

function message(author: Author, createdAt: string, body: string): HTMLElement {
   const name = author.kind === "agent" ? author.name : author.name || author.email
   return h("div", { class: "message" }, [
      avatar(author, 24),
      h("div", { class: "message-text" }, [
         h("div", { class: "message-head" }, [
            h("span", { class: "name" }, [name]),
            author.kind === "agent" && h("span", { class: "chip is-agent" }, ["agent"]),
            h("span", { class: "muted" }, [relativeTime(createdAt)])
         ]),
         h("div", { class: "message-body" }, [renderBody(body)])
      ])
   ])
}
