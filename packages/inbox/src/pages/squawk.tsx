import { LIMITS } from "@squawk/shared"
import type { Anchor, Author as AuthorValue, SquawkDetail } from "@squawk/shared"
import { useEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { Link, useParams } from "react-router"
import { addComment, getSquawk, updateSquawkStatus } from "../api/client"
import { useQuery } from "../api/hooks"
import { Author, authorName } from "../components/author"
import { Avatar } from "../components/avatar"
import { CopyButton } from "../components/copy-button"
import { EmptyState } from "../components/empty-state"
import {
   CheckIcon,
   ChevronDownIcon,
   ChevronRightIcon,
   ExternalLinkIcon,
   ImageIcon,
   LinkIcon
} from "../components/icons"
import { ErrorNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { ScreenshotWithPin } from "../components/screenshot-with-pin"
import { Skeleton } from "../components/skeleton"
import { StatusChip } from "../components/status-chip"
import { useToast } from "../components/toast"
import { firstLine, formatDateTime, truncate } from "../lib/format"
import {
   buildSquawkPageUrl,
   isSafeHttpUrl,
   siteLink,
   splitParagraphs,
   splitTextIntoLinks
} from "../lib/links"
import { describeUserAgent } from "../lib/user-agent"

export function SquawkPage() {
   const squawkId = useParams().id ?? ""
   const squawk = useQuery(`squawk:${squawkId}`, () => getSquawk(squawkId))

   if (squawk.error !== undefined) {
      return <ErrorNotice error={squawk.error} />
   }
   if (squawk.data === undefined) {
      return <SquawkSkeleton />
   }
   return <SquawkView squawk={squawk.data} onChanged={squawk.reload} />
}

function SquawkSkeleton() {
   return (
      <div role="status" aria-label="Loading">
         <Skeleton width={120} height={12} />
         <div className="detail-columns">
            <div className="detail-main">
               <div className="detail-title-row">
                  <Skeleton width={48} height={24} />
                  <Skeleton width={64} height={20} radius={6} />
                  <Skeleton width="40%" height={16} />
               </div>
               <Skeleton width="100%" height={320} radius={8} />
               <Skeleton width="60%" height={14} />
               <Skeleton width="80%" height={14} />
            </div>
            <div className="detail-aside">
               <Skeleton width="100%" height={240} radius={8} />
            </div>
         </div>
      </div>
   )
}

function SquawkView({ squawk, onChanged }: { squawk: SquawkDetail; onChanged: () => void }) {
   const label = `${squawk.siteKey} #${squawk.number}`
   const title = truncate(firstLine(squawk.body), 80)

   return (
      <>
         <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Sites</Link>
            <span className="breadcrumb-separator">/</span>
            <Link to={siteLink(squawk.siteKey)} className="mono">
               {squawk.siteKey}
            </Link>
            <span className="breadcrumb-separator">/</span>
         </nav>
         <div className="detail-columns">
            <div className="detail-main">
               <header className="detail-title-row">
                  <span className="detail-number">#{squawk.number}</span>
                  <StatusChip status={squawk.status} />
                  <h1 className="detail-title">{title}</h1>
               </header>
               {squawk.screenshot === null ? (
                  <EmptyState
                     icon={<ImageIcon size={22} />}
                     title="No screenshot attached"
                     hint="This squawk was filed without a capture."
                     compact
                  />
               ) : (
                  <ScreenshotWithPin
                     screenshot={squawk.screenshot}
                     anchor={squawk.anchor}
                     label={label}
                  />
               )}
               <section className="thread" aria-label="Thread">
                  <Message
                     author={squawk.author}
                     createdAt={squawk.createdAt}
                     body={squawk.body}
                     kind="first"
                  />
                  {squawk.comments.map(comment => (
                     <Message
                        key={comment.id}
                        author={comment.author}
                        createdAt={comment.createdAt}
                        body={comment.body}
                        kind="reply"
                     />
                  ))}
                  {squawk.status === "resolved" && squawk.resolvedAt !== null && (
                     <p className="resolved-banner">
                        <CheckIcon size={14} />
                        <span>
                           Resolved
                           {squawk.resolvedBy !== null && <> by {authorName(squawk.resolvedBy)}</>}
                           {" · "}
                           <RelativeTime value={squawk.resolvedAt} />
                        </span>
                     </p>
                  )}
               </section>
               <Composer squawk={squawk} onChanged={onChanged} />
            </div>
            <Details squawk={squawk} />
         </div>
      </>
   )
}

function Message({
   author,
   createdAt,
   body,
   kind
}: {
   author: AuthorValue
   createdAt: string
   body: string
   kind: "first" | "reply"
}) {
   return (
      <article className={`message message-${kind}`}>
         <Avatar author={author} size={kind === "first" ? 32 : 24} />
         <div className="message-content">
            <header className="message-header">
               <Author author={author} />
               <RelativeTime value={createdAt} />
            </header>
            <BodyText text={body} />
         </div>
      </article>
   )
}

function BodyText({ text }: { text: string }) {
   return (
      <div className="body-text">
         {splitParagraphs(text).map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>
               {paragraph.split("\n").map((line, lineIndex) => (
                  <span key={lineIndex}>
                     {lineIndex > 0 && <br />}
                     {splitTextIntoLinks(line).map((segment, segmentIndex) =>
                        segment.kind === "link" ? (
                           <a
                              key={segmentIndex}
                              href={segment.href}
                              target="_blank"
                              rel="noopener noreferrer"
                           >
                              {segment.text}
                           </a>
                        ) : (
                           segment.text
                        )
                     )}
                  </span>
               ))}
            </p>
         ))}
      </div>
   )
}

/**
 * Reply box with the status switch. "Resolve" with text in the box sends the reply first, so a
 * closing remark and the status change arrive together.
 */
function Composer({ squawk, onChanged }: { squawk: SquawkDetail; onChanged: () => void }) {
   const [body, setBody] = useState("")
   const [busy, setBusy] = useState<"reply" | "status" | null>(null)
   const [error, setError] = useState<string | null>(null)
   const textarea = useRef<HTMLTextAreaElement>(null)
   const showToast = useToast()
   const nextStatus = squawk.status === "open" ? "resolved" : "open"

   useEffect(() => {
      const element = textarea.current
      if (element === null) {
         return
      }
      element.style.height = "auto"
      element.style.height = `${Math.min(element.scrollHeight, 320)}px`
   }, [body])

   async function sendReply(): Promise<boolean> {
      if (body.trim() === "") {
         return true
      }
      await addComment(squawk.id, body)
      setBody("")
      return true
   }

   async function reply() {
      if (body.trim() === "" || busy !== null) {
         return
      }
      setBusy("reply")
      setError(null)
      try {
         await sendReply()
         onChanged()
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Sending failed.")
      } finally {
         setBusy(null)
      }
   }

   async function changeStatus() {
      if (busy !== null) {
         return
      }
      setBusy("status")
      setError(null)
      try {
         await sendReply()
         await updateSquawkStatus(squawk.id, nextStatus)
         showToast(nextStatus === "resolved" ? "Resolved" : "Reopened")
         onChanged()
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Updating the status failed.")
      } finally {
         setBusy(null)
      }
   }

   function submit(event: FormEvent) {
      event.preventDefault()
      void reply()
   }

   function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
         event.preventDefault()
         void reply()
      }
   }

   return (
      <form className="composer" onSubmit={submit}>
         <label htmlFor="reply" className="visually-hidden">
            Reply
         </label>
         <textarea
            ref={textarea}
            id="reply"
            className="input composer-input"
            rows={2}
            value={body}
            placeholder="Write a reply…"
            maxLength={LIMITS.bodyMaxLength}
            onChange={event => setBody(event.target.value)}
            onKeyDown={handleKeyDown}
         />
         <div className="composer-actions">
            <button
               type="button"
               className="button button-secondary"
               disabled={busy !== null}
               onClick={() => void changeStatus()}
            >
               <CheckIcon size={15} />
               {nextStatus === "resolved" ? "Resolve" : "Reopen"}
            </button>
            <span className="composer-spacer" />
            <button
               type="submit"
               className="button button-primary"
               disabled={busy !== null || body.trim() === ""}
            >
               Reply
               <kbd className="button-kbd">⌘↵</kbd>
            </button>
         </div>
         {error !== null && (
            <p className="error-text" role="alert">
               {error}
            </p>
         )}
      </form>
   )
}

function buildPrompt(squawk: SquawkDetail, inboxUrl: string): string {
   const lines = [
      `## Squawk ${squawk.siteKey}#${squawk.number} (${squawk.status})`,
      "",
      `- Page: \`${squawk.page}\``
   ]
   if (squawk.meta.url !== undefined) {
      lines.push(`- URL: ${squawk.meta.url}`)
   }
   if (squawk.meta.ref !== undefined) {
      lines.push(`- Ref: \`${squawk.meta.ref}\``)
   }
   const viewport = squawk.meta.viewport ?? squawk.anchor?.viewport
   if (viewport !== undefined) {
      lines.push(`- Viewport: ${viewport.width} × ${viewport.height}`)
   }
   lines.push(`- Inbox: ${inboxUrl}`, "", squawk.body.trim())
   if (squawk.anchor !== null) {
      const { selectors } = squawk.anchor
      lines.push("", "Anchor:")
      if (selectors.testId !== undefined) {
         lines.push(`- testId: \`${selectors.testId}\``)
      }
      if (selectors.css !== undefined) {
         lines.push(`- css: \`${selectors.css}\``)
      }
      if (selectors.text !== undefined) {
         lines.push(`- text: "${selectors.text.exact}"`)
      }
      lines.push(`- tag: \`${selectors.tagName}\``)
   }
   if (squawk.comments.length > 0) {
      lines.push("", "Replies:")
      for (const comment of squawk.comments) {
         lines.push(`- ${authorName(comment.author)}: ${comment.body.trim().replace(/\n+/g, " ")}`)
      }
   }
   return `${lines.join("\n")}\n`
}

function Details({ squawk }: { squawk: SquawkDetail }) {
   const { meta } = squawk
   const viewport = meta.viewport ?? squawk.anchor?.viewport
   const inboxUrl = `${window.location.origin}/squawks/${squawk.id}`
   const rows: Array<{ label: string; value: ReactNode }> = []

   rows.push({
      label: "Page",
      value: (
         <>
            <span className="mono break">{squawk.page}</span>
            {meta.url !== undefined && isSafeHttpUrl(meta.url) && (
               <a
                  href={buildSquawkPageUrl(meta.url, squawk.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="detail-link"
                  title={meta.url}
               >
                  Open page <ExternalLinkIcon size={12} />
               </a>
            )}
         </>
      )
   })
   if (meta.url !== undefined && !isSafeHttpUrl(meta.url)) {
      rows.push({ label: "URL", value: <span className="break">{meta.url}</span> })
   }
   if (meta.title !== undefined) {
      rows.push({ label: "Title", value: meta.title })
   }
   if (meta.ref !== undefined) {
      rows.push({ label: "Ref", value: <span className="mono break">{meta.ref}</span> })
   }
   if (meta.appVersion !== undefined) {
      rows.push({ label: "App version", value: meta.appVersion })
   }
   if (viewport !== undefined) {
      const ratio = meta.devicePixelRatio === undefined ? "" : ` @${meta.devicePixelRatio}x`
      rows.push({ label: "Viewport", value: `${viewport.width} × ${viewport.height}${ratio}` })
   }
   if (meta.userAgent !== undefined) {
      const short = describeUserAgent(meta.userAgent)
      rows.push({
         label: "Browser",
         value: (
            <span title={meta.userAgent} className={short === null ? "break" : undefined}>
               {short ?? truncate(meta.userAgent, 60)}
            </span>
         )
      })
   }
   rows.push({ label: "Filed by", value: <Author author={squawk.author} showAvatar /> })
   rows.push({
      label: "Created",
      value: (
         <span title={formatDateTime(squawk.createdAt)}>{formatDateTime(squawk.createdAt)}</span>
      )
   })
   if (squawk.anchor !== null) {
      rows.push({ label: "Anchor", value: <AnchorChips anchor={squawk.anchor} /> })
   }
   if (squawk.screenshot !== null) {
      rows.push({
         label: "Source",
         value: squawk.screenshot.source === "extension" ? "Exact (extension)" : "Approximate (DOM)"
      })
   }
   for (const [key, value] of Object.entries(meta.extra ?? {})) {
      rows.push({ label: key, value: String(value) })
   }

   return (
      <aside className="detail-aside" aria-label="Details">
         <section className="card details-card">
            <h2 className="card-title">Details</h2>
            <dl className="details-list">
               {rows.map(row => (
                  <div key={row.label} className="details-row">
                     <dt>{row.label}</dt>
                     <dd>{row.value}</dd>
                  </div>
               ))}
            </dl>
            <div className="details-actions">
               <CopyButton text={inboxUrl} label="Copy link" confirmation="Link copied">
                  <LinkIcon size={14} />
                  <span>Copy link</span>
               </CopyButton>
               <CopyButton
                  text={buildPrompt(squawk, inboxUrl)}
                  label="Copy as prompt"
                  confirmation="Prompt copied"
               >
                  <ChevronRightIcon size={14} />
                  <span>Copy as prompt</span>
               </CopyButton>
            </div>
         </section>
      </aside>
   )
}

function AnchorChips({ anchor }: { anchor: Anchor }) {
   const [open, setOpen] = useState(false)
   const { selectors } = anchor
   const chips: Array<{ name: string; value: string }> = []
   if (selectors.testId !== undefined) {
      chips.push({ name: "testId", value: selectors.testId })
   }
   if (selectors.css !== undefined) {
      chips.push({ name: "css", value: selectors.css })
   }
   chips.push({ name: "tag", value: selectors.tagName })

   return (
      <div className="anchor-chips">
         <button
            type="button"
            className="anchor-toggle"
            aria-expanded={open}
            onClick={() => setOpen(current => !current)}
         >
            <span className="mono">{truncate(chips[0]?.value ?? selectors.tagName, 28)}</span>
            <ChevronDownIcon size={13} className={open ? "rotate-180" : undefined} />
         </button>
         {open && (
            <ul className="anchor-list">
               {chips.map(chip => (
                  <li key={chip.name}>
                     <span className="anchor-name">{chip.name}</span>
                     <code className="code break">{chip.value}</code>
                  </li>
               ))}
               {selectors.text !== undefined && (
                  <li>
                     <span className="anchor-name">text</span>
                     <code className="code break">{truncate(selectors.text.exact, 80)}</code>
                  </li>
               )}
            </ul>
         )}
      </div>
   )
}
