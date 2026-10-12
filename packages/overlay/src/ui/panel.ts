import { markdownPreview } from "@squawk/shared"
import type { Squawk } from "@squawk/shared"
import type { LoginState } from "../auth"
import { groupByPage } from "../state"
import type { ListFilter, OverlayState } from "../state"
import { copyText } from "./clipboard"
import { autoGrow, avatar, avatarStack, h, icon, spinner, squawkMark } from "./dom"
import { authorName, authorTooltip, plural, relativeTime } from "./format"
import { iconButton } from "./thread"

export interface PanelHandlers {
   close(): void
   startPinMode(): void
   setFilter(filter: ListFilter): void
   openThread(squawkId: string): void
   /** The list row under the pointer, or null when it left; highlights its pin. */
   hoverSquawk(squawkId: string | null): void
   /** Scrolls the page to a draft's pin while it is edited. */
   revealDraft(squawkId: string): void
   signIn(): void
   signInWithCode(): void
   cancelSignIn(): void
   signOut(): void
   updateDraft(squawkId: string, body: string): Promise<void>
   deleteDraft(squawkId: string): Promise<void>
   submitReview(): Promise<void>
}

export interface Panel {
   element: HTMLElement
   /** `thread` is the open thread's view, shown when `state.panel` is `thread`. */
   render(state: OverlayState, thread: HTMLElement | null): void
   /** Shows skeleton rows until the first list of the site has arrived. */
   setLoaded(loaded: boolean): void
   /** Squawks of this page whose pin could not be placed; shown in the tray. */
   setOrphans(squawks: Squawk[]): void
   /** Marks the list row whose page pin is under the pointer. */
   setHoveredPin(squawkId: string | null): void
   /** Opens the inline editor of a draft, e.g. after its pin was clicked. */
   editDraft(squawkId: string): void
}

const RENDER_KEYS = [
   "panel",
   "token",
   "login",
   "squawks",
   "drafts",
   "me",
   "filter",
   "threadId",
   "siteKey",
   "pageKey"
] as const satisfies readonly (keyof OverlayState)[]

const SKELETON_ROWS = 4
const COPIED_FEEDBACK_MS = 1200
const DELETE_CONFIRM_MS = 3000

/** Sidebar on the right (bottom sheet on phones): sign-in, review, squawk list or a thread. */
export function createPanel(handlers: PanelHandlers): Panel {
   const siteLabel = h("code", { class: "site" })
   const newButton = iconButton("plus", "New squawk (C)", () => handlers.startPinMode())
   newButton.classList.add("new-button")
   const openTab = segment("open", "Open")
   const resolvedTab = segment("resolved", "Resolved")
   const segmented = h("div", { class: "segmented", role: "group", "aria-label": "Filter" }, [
      openTab.button,
      resolvedTab.button
   ])
   const header = h("div", { class: "panel-header" }, [
      h("div", { class: "panel-top" }, [
         h("span", { class: "panel-mark", title: "Squawk" }, [squawkMark(18)]),
         siteLabel,
         h("span", { class: "spacer" }),
         newButton,
         iconButton("close", "Close (Esc)", () => handlers.close())
      ]),
      segmented
   ])
   const tray = h("div", { class: "orphan-tray", hidden: true })
   const body = h("div", { class: "panel-body" })
   const account = h("div", { class: "account" })
   const footer = h("div", { class: "panel-footer", hidden: true }, [
      account,
      h("button", { class: "text-button", type: "button", onclick: () => handlers.signOut() }, [
         "Sign out"
      ])
   ])
   const element = h(
      "aside",
      { class: "panel", "aria-label": "Squawks", "aria-hidden": "true", inert: true },
      [header, tray, body, footer]
   )
   let previous: OverlayState | null = null
   let previousThread: HTMLElement | null = null
   let bodyKey = ""
   let loaded = false
   let hoveredPinId: string | null = null
   let shownThreadId: string | null = null
   /** Open draft editors by squawk id; they survive re-renders so typing is never lost. */
   const draftEditors = new Map<string, HTMLElement>()

   function segment(
      filter: ListFilter,
      label: string
   ): { button: HTMLButtonElement; count: HTMLElement } {
      const count = h("span", { class: "count" })
      const button = h(
         "button",
         { class: "segment", type: "button", onclick: () => handlers.setFilter(filter) },
         [label, count]
      )
      return { button, count }
   }

   function showBody(key: string, content: Node[]): void {
      const scrollTop = key === bodyKey ? body.scrollTop : 0
      body.replaceChildren(...content)
      body.scrollTop = scrollTop
      bodyKey = key
   }

   function applyHoveredPin(): void {
      for (const row of body.querySelectorAll<HTMLElement>(".item")) {
         row.classList.toggle("is-active", row.dataset.id === hoveredPinId)
      }
   }

   function rerender(): void {
      if (previous) render(previous, previousThread)
   }

   function render(state: OverlayState, thread: HTMLElement | null): void {
      const open = state.panel !== "closed"
      element.classList.toggle("is-open", open)
      element.setAttribute("aria-hidden", String(!open))
      element.toggleAttribute("inert", !open)
      if (!open) {
         bodyKey = ""
         shownThreadId = null
         return
      }
      siteLabel.textContent = state.siteKey
      siteLabel.title = `Site ${state.siteKey}`
      newButton.hidden = !state.token
      const listing = Boolean(state.token) && state.panel !== "thread"
      segmented.hidden = !listing
      tray.hidden = !listing || tray.childElementCount === 0
      footer.hidden = !state.token
      renderAccount(state)
      renderSegments(state)
      if (!state.token) return showBody("sign-in", [signInView(state.login, handlers)])
      if (state.panel === "thread" && thread) return showBody(`thread:${state.threadId}`, [thread])
      showBody("list", listView(state))
      applyHoveredPin()
      if (state.threadId !== shownThreadId) {
         shownThreadId = state.threadId
         body.querySelector(".item.is-selected")?.scrollIntoView({ block: "nearest" })
      }
   }

   function renderAccount(state: OverlayState): void {
      const principal = state.me?.principal
      account.replaceChildren(
         ...(principal
            ? [
                 avatar(principal, 20),
                 h("span", { class: "name", title: authorTooltip(principal) }, [
                    principal.kind === "user" ? principal.name || principal.email : principal.name
                 ])
              ]
            : [])
      )
   }

   function renderSegments(state: OverlayState): void {
      const counts = { open: 0, resolved: 0 }
      for (const squawk of state.squawks) {
         if (squawk.status !== "draft") counts[squawk.status]++
      }
      for (const [filter, tab] of [
         ["open", openTab],
         ["resolved", resolvedTab]
      ] as const) {
         tab.count.textContent = String(counts[filter])
         tab.button.classList.toggle("is-selected", state.filter === filter)
         tab.button.setAttribute("aria-pressed", String(state.filter === filter))
      }
   }

   // ---- list --------------------------------------------------------------------------------

   function listView(state: OverlayState): Node[] {
      const nodes: Node[] = []
      if (state.drafts.length > 0) nodes.push(reviewBlock(state))
      const groups = groupByPage(state)
      for (const [page, squawks] of groups) {
         const current = page === state.pageKey
         nodes.push(
            h("section", { class: "group", "aria-label": current ? "This page" : page }, [
               h("h3", { class: "group-title", title: page }, [
                  current ? "This page" : page,
                  h("span", { class: "count" }, [String(squawks.length)])
               ]),
               ...squawks.map(squawk => listItem(squawk, state.threadId === squawk.id))
            ])
         )
      }
      if (groups.length > 0) return nodes
      if (!loaded && state.squawks.length === 0) return [...nodes, ...skeletonRows()]
      return [...nodes, emptyState(state.filter)]
   }

   function listItem(squawk: Squawk, selected: boolean): HTMLElement {
      const replies = squawk.commentCount
      const resolved = squawk.status === "resolved"
      const row = h(
         "button",
         {
            class: `item${resolved ? " is-resolved" : ""}${selected ? " is-selected" : ""}`,
            type: "button",
            "data-id": squawk.id,
            "aria-current": selected ? "true" : null,
            onclick: () => handlers.openThread(squawk.id),
            onpointerenter: () => handlers.hoverSquawk(squawk.id),
            onpointerleave: () => handlers.hoverSquawk(null)
         },
         [
            avatarStack([squawk.author, squawk.lastAuthor]),
            h("div", { class: "item-text" }, [
               h("div", { class: "item-head" }, [
                  h("span", { class: "name", title: authorTooltip(squawk.author) }, [
                     authorName(squawk.author)
                  ]),
                  h("span", { class: "time" }, [
                     relativeTime(squawk.submittedAt ?? squawk.createdAt)
                  ]),
                  h("span", { class: "number" }, [`#${squawk.number}`])
               ]),
               h("div", { class: "item-body" }, [markdownPreview(squawk.body)]),
               (replies > 0 || resolved) &&
                  h("div", { class: "item-meta" }, [
                     resolved && h("span", { class: "resolved" }, [icon("check", 12), "Resolved"]),
                     replies > 0 &&
                        h(
                           "span",
                           {
                              class: "replies",
                              title: `Last reply by ${authorName(squawk.lastAuthor)}`
                           },
                           [icon("comment", 12), plural(replies, "reply", "replies")]
                        )
                  ])
            ])
         ]
      )
      return row
   }

   // ---- review ------------------------------------------------------------------------------

   function reviewBlock(state: OverlayState): HTMLElement {
      const count = state.drafts.length
      const error = h("div", { class: "error", role: "alert", hidden: true })
      const submit = h("button", { class: "button primary submit-review", type: "button" }, [
         h("span", {}, [`Submit review (${count})`]),
         spinner()
      ])
      submit.addEventListener("click", () => {
         if (submit.disabled) return
         submit.disabled = true
         submit.classList.add("is-busy")
         error.hidden = true
         handlers.submitReview().catch((failure: unknown) => {
            error.textContent = failure instanceof Error ? failure.message : "Submitting failed"
            error.hidden = false
            submit.disabled = false
            submit.classList.remove("is-busy")
         })
      })
      const drafts = [...state.drafts].sort((first, second) => first.number - second.number)
      return h("section", { class: "review", "aria-label": "Your review" }, [
         h("div", { class: "review-head" }, [
            h("h3", {}, ["Your review"]),
            h("span", { class: "muted" }, [plural(count, "draft")]),
            h("span", { class: "review-hint" }, ["Only you can see drafts"])
         ]),
         h(
            "ul",
            { class: "drafts" },
            drafts.map(draft => draftEditors.get(draft.id) ?? draftRow(draft, state))
         ),
         submit,
         error
      ])
   }

   function draftRow(draft: Squawk, state: OverlayState): HTMLElement {
      let confirmTimer: ReturnType<typeof setTimeout> | undefined
      const deleteButton = h(
         "button",
         {
            class: "icon-button delete",
            type: "button",
            title: "Delete draft",
            "aria-label": "Delete draft"
         },
         [icon("trash", 14)]
      )
      const resetDelete = (): void => {
         clearTimeout(confirmTimer)
         deleteButton.classList.remove("is-confirm")
         deleteButton.replaceChildren(icon("trash", 14))
         deleteButton.setAttribute("aria-label", "Delete draft")
      }
      deleteButton.addEventListener("click", () => {
         if (!deleteButton.classList.contains("is-confirm")) {
            deleteButton.classList.add("is-confirm")
            deleteButton.replaceChildren("Delete")
            deleteButton.setAttribute("aria-label", "Confirm deleting the draft")
            confirmTimer = setTimeout(resetDelete, DELETE_CONFIRM_MS)
            return
         }
         resetDelete()
         deleteButton.disabled = true
         handlers.deleteDraft(draft.id).catch(() => (deleteButton.disabled = false))
      })
      const elsewhere = draft.page !== state.pageKey
      return h("li", { class: "draft", "data-id": draft.id }, [
         h("span", { class: "draft-number" }, [`#${draft.number}`]),
         h(
            "button",
            {
               class: "draft-body",
               type: "button",
               title: "Edit draft",
               onclick: () => startEditing(draft),
               onpointerenter: () => handlers.hoverSquawk(draft.id),
               onpointerleave: () => handlers.hoverSquawk(null)
            },
            [
               h("span", { class: "draft-text" }, [markdownPreview(draft.body)]),
               elsewhere && h("span", { class: "draft-page", title: draft.page }, [draft.page])
            ]
         ),
         iconButton("pencil", "Edit draft", () => startEditing(draft)),
         deleteButton
      ])
   }

   function startEditing(draft: Squawk): void {
      if (!draftEditors.has(draft.id)) draftEditors.set(draft.id, draftEditor(draft))
      rerender()
      handlers.revealDraft(draft.id)
      const textarea = draftEditors.get(draft.id)?.querySelector("textarea")
      textarea?.focus()
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
   }

   function draftEditor(draft: Squawk): HTMLElement {
      const textarea = h("textarea", { "aria-label": `Edit draft #${draft.number}` })
      textarea.value = draft.body
      autoGrow(textarea, 2, 8)
      const error = h("div", { class: "error", role: "alert", hidden: true })
      const save = h("button", { class: "button primary small", type: "button" }, [
         h("span", {}, ["Save"]),
         spinner()
      ])
      const stop = (): void => {
         draftEditors.delete(draft.id)
         rerender()
      }
      const cancel = h("button", { class: "button ghost small", type: "button", onclick: stop }, [
         "Cancel"
      ])
      const commit = (): void => {
         const next = textarea.value.trim()
         if (save.disabled) return
         if (!next || next === draft.body) return stop()
         save.disabled = true
         textarea.disabled = true
         save.classList.add("is-busy")
         error.hidden = true
         handlers.updateDraft(draft.id, next).then(stop, (failure: unknown) => {
            error.textContent = failure instanceof Error ? failure.message : "Saving failed"
            error.hidden = false
            save.disabled = false
            textarea.disabled = false
            save.classList.remove("is-busy")
            textarea.focus()
         })
      }
      save.addEventListener("click", commit)
      textarea.addEventListener("keydown", event => {
         if (event.key === "Escape") {
            event.preventDefault()
            stop()
            return
         }
         if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
         event.preventDefault()
         commit()
      })
      return h("li", { class: "draft is-editing", "data-id": draft.id }, [
         h("span", { class: "draft-number" }, [`#${draft.number}`]),
         h("div", { class: "draft-editor" }, [
            textarea,
            error,
            h("div", { class: "actions" }, [cancel, save])
         ])
      ])
   }

   return {
      element,
      render(state, thread) {
         const changed =
            !previous ||
            thread !== previousThread ||
            RENDER_KEYS.some(key => previous?.[key] !== state[key])
         previous = state
         previousThread = thread
         // Editors of drafts that were submitted or deleted elsewhere go away.
         for (const id of draftEditors.keys()) {
            if (!state.drafts.some(draft => draft.id === id)) draftEditors.delete(id)
         }
         if (changed) render(state, thread)
      },
      setLoaded(next) {
         if (loaded === next) return
         loaded = next
         if (bodyKey === "list") rerender()
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
                        class: `pin${squawk.status === "resolved" ? " is-resolved" : ""}${squawk.status === "draft" ? " is-draft" : ""}`,
                        type: "button",
                        title: `#${squawk.number}: ${markdownPreview(squawk.body)}`,
                        onclick: () =>
                           squawk.status === "draft"
                              ? startEditing(squawk)
                              : handlers.openThread(squawk.id)
                     },
                     [h("span", {}, [String(squawk.number)])]
                  )
               )
            )
         }
         tray.hidden =
            squawks.length === 0 ||
            !previous?.token ||
            previous.panel === "thread" ||
            previous.panel === "closed"
      },
      setHoveredPin(squawkId) {
         hoveredPinId = squawkId
         applyHoveredPin()
      },
      editDraft(squawkId) {
         const draft = previous?.drafts.find(candidate => candidate.id === squawkId)
         if (draft) startEditing(draft)
      }
   }
}

// ---- sign-in -------------------------------------------------------------------------------

function signInView(login: LoginState | null, handlers: PanelHandlers): HTMLElement {
   const signInButton = (onclick: () => void): HTMLElement =>
      h("button", { class: "button primary", type: "button", onclick }, [
         login ? "Try again" : "Sign in"
      ])
   const textButton = (label: string, onclick: () => void): HTMLElement =>
      h("button", { class: "text-button", type: "button", onclick }, [label])
   const useCode = (): HTMLElement =>
      textButton("Use a code instead", () => handlers.signInWithCode())
   const cancel = (): HTMLElement => textButton("Cancel", () => handlers.cancelSignIn())
   const retryWithPopup = (): HTMLElement => signInButton(() => handlers.signIn())
   const retryWithCode = (): HTMLElement => signInButton(() => handlers.signInWithCode())

   const view = h("div", { class: "sign-in" }, [
      squawkMark(28),
      h("div", { class: "title" }, ["Sign in to Squawk"])
   ])
   if (!login) {
      view.append(
         h("p", { class: "muted" }, ["See and add squawks on this page with your team account."]),
         retryWithPopup(),
         useCode()
      )
      return view
   }
   switch (login.status) {
      case "popup":
         view.append(
            h("p", { class: "waiting" }, ["Finish signing in in the window that just opened."]),
            cancel()
         )
         break
      case "cancelled":
         view.append(
            h("p", { class: "muted" }, ["Sign-in cancelled."]),
            retryWithPopup(),
            useCode()
         )
         break
      case "closed":
         view.append(
            h("p", { class: "muted" }, ["The sign-in window was closed."]),
            retryWithPopup(),
            useCode()
         )
         break
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
         view.append(h("p", { class: "muted" }, ["The sign-in was denied."]), retryWithCode())
         break
      case "expired":
         view.append(h("p", { class: "muted" }, ["The code expired."]), retryWithCode())
         break
      case "error":
         view.append(h("p", { class: "error" }, [login.message]), retryWithCode())
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

function emptyState(filter: ListFilter): HTMLElement {
   const open = filter === "open"
   return h("div", { class: "empty" }, [
      h("span", { class: "empty-icon" }, [icon(open ? "comment" : "check", 20)]),
      h("div", { class: "title" }, [open ? "No open squawks" : "Nothing resolved yet"]),
      h(
         "div",
         { class: "hint" },
         open
            ? [
                 "Press ",
                 h("kbd", {}, ["C"]),
                 " or click ",
                 h("kbd", {}, ["+"]),
                 " to leave the first squawk"
              ]
            : ["Resolved squawks of this site show up here."]
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
