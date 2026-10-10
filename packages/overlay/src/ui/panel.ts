import { LIMITS } from "@squawk/shared"
import type { Squawk, SquawkDetail, SquawkStatus } from "@squawk/shared"
import type { DeviceLoginState } from "../auth"
import type { ListFilter, OverlayState } from "../state"
import { h, icon } from "./dom"
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

/** Slide-over on the right: sign-in, the squawk list, or one thread. */
export function createPanel(handlers: PanelHandlers): Panel {
   const siteLabel = h("div", { class: "site" })
   const pageLabel = h("div", { class: "page" })
   const newButton = iconButton("plus", "New squawk (C)", () => handlers.startPinMode())
   const header = h("div", { class: "panel-header" }, [
      h("div", { class: "panel-title" }, [siteLabel, pageLabel]),
      newButton,
      iconButton("close", "Close", () => handlers.close())
   ])
   const body = h("div", { class: "panel-body" })
   const element = h("aside", { class: "panel", "aria-label": "Squawks" }, [header, body])
   let previous: OverlayState | null = null
   let bodyKey = ""
   let threadView: ThreadView | null = null

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

   return {
      element,
      render(state) {
         const changed = !previous || RENDER_KEYS.some(key => previous?.[key] !== state[key])
         previous = state
         if (!changed) return
         element.classList.toggle("is-open", state.panel !== "closed")
         if (state.panel === "closed") {
            disposeThreadView()
            bodyKey = ""
            return
         }
         siteLabel.textContent = state.siteKey
         pageLabel.textContent = state.pageKey
         newButton.hidden = !state.token
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
         showBody("list", listView(state, handlers))
      }
   }
}

function iconButton(
   name: Parameters<typeof icon>[0],
   label: string,
   onclick: () => void
): HTMLButtonElement {
   return h(
      "button",
      { class: "icon-button", type: "button", title: label, "aria-label": label, onclick },
      [icon(name)]
   )
}

function signInView(login: DeviceLoginState | null, handlers: PanelHandlers): HTMLElement {
   const signInButton = h(
      "button",
      { class: "button primary", type: "button", onclick: () => handlers.signIn() },
      [login ? "Try again" : "Sign in"]
   )
   const view = h("div", { class: "sign-in" })
   if (!login) {
      view.append(h("p", {}, ["Sign in to see and add squawks on this page."]), signInButton)
      return view
   }
   switch (login.status) {
      case "starting":
         view.append(h("p", { class: "muted" }, ["Requesting a sign-in code…"]))
         break
      case "waiting":
         view.append(
            h("p", {}, ["Confirm this code on the approval page:"]),
            h("div", { class: "user-code" }, [login.userCode]),
            h(
               "a",
               {
                  class: "button primary",
                  href: login.verificationUrl,
                  target: "_blank",
                  rel: "noopener"
               },
               ["Open approval page"]
            ),
            h("p", { class: "muted" }, ["Waiting for approval…"]),
            h(
               "button",
               { class: "button", type: "button", onclick: () => handlers.cancelSignIn() },
               ["Cancel"]
            )
         )
         break
      case "approved":
         view.append(h("p", {}, ["Signed in."]))
         break
      case "denied":
         view.append(h("p", {}, ["The sign-in was denied."]), signInButton)
         break
      case "expired":
         view.append(h("p", {}, ["The code expired."]), signInButton)
         break
      case "error":
         view.append(h("p", { class: "error" }, [login.message]), signInButton)
         break
   }
   return view
}

function listView(state: OverlayState, handlers: PanelHandlers): HTMLElement {
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
         [`${label} ${counts[filter]}`]
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
      const title = page === state.pageKey ? "This page" : page
      sections.push(
         h("section", {}, [
            h("h3", { class: "group-title", title: page }, [title]),
            ...squawks.map(squawk => listItem(squawk, handlers))
         ])
      )
   }
   const empty =
      sections.length === 0 &&
      h("p", { class: "empty" }, [
         state.filter === "open" ? "No open squawks on this site." : "Nothing resolved yet."
      ])
   return h("div", {}, [
      h("div", { class: "tabs" }, [tab("open", "Open"), tab("resolved", "Resolved")]),
      empty,
      ...sections
   ])
}

function listItem(squawk: Squawk, handlers: PanelHandlers): HTMLElement {
   return h(
      "button",
      { class: "item", type: "button", onclick: () => handlers.openThread(squawk.id) },
      [
         h("div", { class: "item-top" }, [
            h("span", { class: "number" }, [`#${squawk.number}`]),
            h("span", { class: "item-body" }, [firstLine(squawk.body)])
         ]),
         h("div", { class: "item-meta" }, [
            h("span", {}, [authorName(squawk.author)]),
            h("span", {}, [relativeTime(squawk.createdAt)]),
            h("span", {}, [
               `${squawk.commentCount} ${squawk.commentCount === 1 ? "reply" : "replies"}`
            ])
         ])
      ]
   )
}

interface ThreadView {
   squawkId: string
   element: HTMLElement
   update(state: OverlayState): void
   dispose(): void
}

function createThreadView(squawkId: string, handlers: PanelHandlers): ThreadView {
   const title = h("span", { class: "thread-title" })
   const status = h("span", { class: "status" })
   const shot = h("div", { class: "shot" })
   const messages = h("div", { class: "messages" }, [h("p", { class: "muted" }, ["Loading…"])])
   const textarea = h("textarea", {
      placeholder: "Reply…",
      maxlength: LIMITS.bodyMaxLength,
      rows: 3
   })
   const replyButton = h("button", { class: "button primary", type: "button" }, ["Reply"])
   const statusButton = h("button", { class: "button", type: "button" })
   const copyButton = h("button", { class: "button", type: "button" }, ["Copy link"])
   const pageLink = h("a", { class: "button", hidden: true }, ["Go to page"])
   const error = h("div", { class: "error", hidden: true })
   const element = h("div", { class: "thread" }, [
      h("div", { class: "thread-header" }, [
         iconButton("back", "Back to list", () => handlers.showList()),
         title,
         status
      ]),
      shot,
      messages,
      h("div", { class: "reply" }, [
         textarea,
         error,
         h("div", { class: "actions" }, [replyButton])
      ]),
      h("div", { class: "thread-actions" }, [statusButton, copyButton, pageLink])
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
   copyButton.addEventListener("click", () => {
      if (detail) handlers.copyLink(detail)
   })

   function loadScreenshot(path: string): void {
      handlers.loadScreenshot(path).then(
         blob => {
            if (disposed) return
            screenshotUrl = URL.createObjectURL(blob)
            shot.replaceChildren(h("img", { src: screenshotUrl, alt: "Screenshot" }))
         },
         () => {
            if (!disposed)
               shot.replaceChildren(h("p", { class: "muted" }, ["Screenshot unavailable."]))
         }
      )
   }

   return {
      squawkId,
      element,
      update(state) {
         const next = state.thread?.id === squawkId ? state.thread : null
         if (!next || next === detail) return
         if (!detail && next.screenshot) loadScreenshot(next.screenshot.url)
         detail = next
         title.textContent = `#${next.number}`
         status.textContent = next.status === "open" ? "Open" : "Resolved"
         status.className = `status is-${next.status}`
         statusButton.textContent = next.status === "open" ? "Resolve" : "Reopen"
         const pageUrl = next.page !== state.pageKey ? next.meta.url : undefined
         pageLink.hidden = !pageUrl
         if (pageUrl) pageLink.setAttribute("href", pageUrl)
         messages.replaceChildren(...threadMessages(next))
      },
      dispose() {
         disposed = true
         if (screenshotUrl) URL.revokeObjectURL(screenshotUrl)
      }
   }
}

/** The squawk body followed by its replies. */
function threadMessages(detail: SquawkDetail): HTMLElement[] {
   return [
      message(detail.author, detail.createdAt, detail.body),
      ...detail.comments.map(comment => message(comment.author, comment.createdAt, comment.body))
   ]
}

function message(author: SquawkDetail["author"], createdAt: string, body: string): HTMLElement {
   return h("div", { class: "message" }, [
      h("div", { class: "message-meta" }, [`${authorName(author)} · ${relativeTime(createdAt)}`]),
      h("div", { class: "message-body" }, [renderBody(body)])
   ])
}
