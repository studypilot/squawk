import { LIMITS, renderMarkdown } from "@squawk/shared"
import type { Author, Squawk, SquawkDetail, SquawkTargetStatus } from "@squawk/shared"
import type { OverlayState } from "../state"
import { autoGrow, avatar, h, icon, spinner, workingSince } from "./dom"
import type { IconName } from "./dom"
import { authorName, authorTooltip, isAgent, relativeTime } from "./format"

/** Next to its pin on the page, or inside the panel (other pages, lost pins, phones). */
export type ThreadPlacement = "popover" | "panel"

export interface ThreadHandlers {
   /** Closes the popover, or goes back to the list in the panel. */
   close(): void
   reply(squawkId: string, body: string): Promise<void>
   setStatus(squawkId: string, status: SquawkTargetStatus): Promise<void>
   copyLink(squawk: Squawk): void
   /** Marks the squawk unread again and closes the thread. */
   markUnread(squawkId: string): void
   /** Clears the agent's work claim. */
   clearWorking(squawkId: string): Promise<void>
   loadScreenshot(path: string): Promise<Blob>
}

export interface ThreadView {
   squawkId: string
   element: HTMLElement
   update(state: OverlayState, placement: ThreadPlacement): void
   dispose(): void
}

export function iconButton(name: IconName, label: string, onclick: () => void): HTMLButtonElement {
   return h(
      "button",
      { class: "icon-button", type: "button", title: label, "aria-label": label, onclick },
      [icon(name)]
   )
}

/** One squawk: header with Resolve, the screenshot, the messages and the reply field. */
export function createThreadView(squawkId: string, handlers: ThreadHandlers): ThreadView {
   const title = h("span", { class: "thread-title" })
   const status = h("span", { class: "chip status" })
   const banner = h("div", { class: "thread-banner", hidden: true })
   const workingBanner = h("div", { class: "thread-banner is-working", hidden: true })
   const shot = h("button", {
      class: "shot",
      type: "button",
      "aria-label": "Enlarge screenshot",
      hidden: true
   })
   const messages = h("div", { class: "messages" }, threadSkeleton())
   const textarea = h("textarea", {
      placeholder: "Reply…",
      "aria-label": "Reply",
      maxlength: LIMITS.bodyMaxLength
   })
   autoGrow(textarea, 1, 6)
   const replyButton = h(
      "button",
      { class: "send-button", type: "button", title: "Reply (Enter)", "aria-label": "Reply" },
      [icon("send", 14), spinner()]
   )
   const statusButton = h("button", { class: "button small resolve", type: "button" })
   const backButton = iconButton("back", "Back to list (Esc)", () => handlers.close())
   const closeButton = iconButton("close", "Close (Esc)", () => handlers.close())
   const shotButton = iconButton("image", "Show screenshot", () => openLightbox())
   const copyButton = iconButton("link", "Copy link", () => {
      if (detail) handlers.copyLink(detail)
   })
   const unreadButton = iconButton("unread", "Mark as unread (U)", () =>
      handlers.markUnread(squawkId)
   )
   const pageLink = h(
      "a",
      {
         class: "icon-button",
         title: "Open the page",
         "aria-label": "Open the page",
         hidden: true
      },
      [icon("external")]
   )
   const error = h("div", { class: "error", role: "alert", hidden: true })
   const element = h("div", { class: "thread", "aria-busy": "true" }, [
      h("div", { class: "thread-header" }, [
         backButton,
         title,
         status,
         h("span", { class: "spacer" }),
         shotButton,
         pageLink,
         copyButton,
         unreadButton,
         statusButton,
         closeButton
      ]),
      banner,
      workingBanner,
      shot,
      messages,
      h("div", { class: "thread-footer" }, [
         h("div", { class: "reply" }, [textarea, replyButton]),
         error
      ])
   ])
   let detail: SquawkDetail | null = null
   let screenshotUrl: string | null = null
   let disposed = false

   async function run(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
      if (button.disabled) return
      button.disabled = true
      button.classList.add("is-busy")
      error.hidden = true
      try {
         await action()
      } catch (failure) {
         error.textContent = failure instanceof Error ? failure.message : "Something went wrong"
         error.hidden = false
      } finally {
         button.disabled = false
         button.classList.remove("is-busy")
      }
   }

   function sendReply(): void {
      const body = textarea.value.trim()
      if (!body || !detail || textarea.disabled) return
      textarea.disabled = true
      void run(replyButton, async () => {
         try {
            await handlers.reply(squawkId, body)
            textarea.value = ""
            textarea.dispatchEvent(new Event("input"))
         } finally {
            textarea.disabled = false
            textarea.focus()
         }
      })
   }

   replyButton.addEventListener("click", sendReply)
   textarea.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
      event.preventDefault()
      sendReply()
   })
   statusButton.addEventListener("click", () => {
      if (!detail || detail.status === "draft") return
      const next: SquawkTargetStatus = detail.status === "open" ? "resolved" : "open"
      void run(statusButton, () => handlers.setStatus(squawkId, next))
   })

   function renderWorking(next: SquawkDetail): void {
      const working = next.working
      workingBanner.hidden = !working
      if (!working) return workingBanner.replaceChildren()
      const clear = h("button", { class: "text-button", type: "button" }, ["Clear"])
      clear.addEventListener("click", () => {
         clear.disabled = true
         error.hidden = true
         handlers.clearWorking(squawkId).catch((failure: unknown) => {
            error.textContent = failure instanceof Error ? failure.message : "Clearing failed"
            error.hidden = false
            clear.disabled = false
         })
      })
      workingBanner.replaceChildren(
         h("span", { class: "working-icon" }, [icon("sparkle", 14)]),
         h("span", { class: "working-text", title: authorTooltip(working.by) }, [
            `${authorName(working.by)} is working on this`,
            h("span", { class: "muted" }, [" · ", workingSince(working.since)])
         ]),
         clear
      )
   }

   function openLightbox(): void {
      if (!screenshotUrl) return
      const lightbox = h("div", { class: "lightbox", role: "dialog", "aria-label": "Screenshot" })
      const close = (): void => {
         lightbox.remove()
         window.removeEventListener("keydown", onKey, true)
      }
      const onKey = (event: KeyboardEvent): void => {
         if (event.key !== "Escape") return
         event.preventDefault()
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
            setPlacement(placement)
         },
         () => {
            if (disposed) return
            shot.replaceChildren(h("span", { class: "muted" }, ["Screenshot unavailable."]))
            shot.hidden = false
         }
      )
   }
   shot.addEventListener("click", openLightbox)

   let placement: ThreadPlacement = "panel"
   /** The panel shows the screenshot inline; the popover offers it behind a button. */
   function setPlacement(next: ThreadPlacement): void {
      placement = next
      element.dataset.placement = next
      backButton.hidden = next !== "panel"
      closeButton.hidden = next !== "popover"
      shotButton.hidden = next !== "popover" || screenshotUrl === null
   }
   setPlacement("panel")

   return {
      squawkId,
      element,
      update(state, nextPlacement) {
         setPlacement(nextPlacement)
         const next = state.thread?.id === squawkId ? state.thread : null
         if (!next || next === detail) return
         if (!detail) loadScreenshot(next)
         const grew = detail !== null && next.comments.length > detail.comments.length
         detail = next
         element.removeAttribute("aria-busy")
         title.textContent = `#${next.number}`
         status.textContent = next.status === "resolved" ? "Resolved" : "Open"
         status.className = `chip status is-${next.status}`
         const resolved = next.status === "resolved"
         statusButton.replaceChildren(
            icon(resolved ? "reopen" : "check", 14),
            resolved ? "Reopen" : "Resolve",
            spinner()
         )
         statusButton.title = resolved ? "Reopen" : "Resolve (R)"
         statusButton.classList.toggle("is-resolved", resolved)
         renderWorking(next)
         banner.hidden = !resolved
         if (resolved) {
            banner.replaceChildren(
               icon("check", 14),
               h("span", { title: next.resolvedBy ? authorTooltip(next.resolvedBy) : "" }, [
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
         if (grew) messages.lastElementChild?.scrollIntoView({ block: "nearest" })
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
   const content = h("div", { class: "message-body markdown" })
   // renderMarkdown escapes all text and only emits its own fixed set of tags.
   content.innerHTML = renderMarkdown(body)
   return h("div", { class: isAgent(author) ? "message is-agent" : "message" }, [
      avatar(author, 24),
      h("div", { class: "message-text" }, [
         h("div", { class: "message-head" }, [
            h("span", { class: "name", title: authorTooltip(author) }, [authorName(author)]),
            h("span", { class: "muted" }, [relativeTime(createdAt)])
         ]),
         content
      ])
   ])
}
