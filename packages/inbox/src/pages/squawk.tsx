import { LIMITS } from "@squawk/shared"
import type { Author as AuthorValue, SquawkDetail } from "@squawk/shared"
import { useState } from "react"
import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { Link, useParams } from "react-router"
import { addComment, getSquawk, updateSquawkStatus } from "../api/client"
import { useQuery } from "../api/hooks"
import { Author } from "../components/author"
import { ErrorNotice, LoadingNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { ScreenshotWithPin } from "../components/screenshot-with-pin"
import { StatusChip } from "../components/status-chip"
import { truncate } from "../lib/format"
import {
   buildSquawkPageUrl,
   isSafeHttpUrl,
   siteLink,
   splitParagraphs,
   splitTextIntoLinks
} from "../lib/links"

export function SquawkPage() {
   const squawkId = useParams().id ?? ""
   const squawk = useQuery(`squawk:${squawkId}`, () => getSquawk(squawkId))

   if (squawk.error !== undefined) {
      return <ErrorNotice error={squawk.error} />
   }
   if (squawk.data === undefined) {
      return <LoadingNotice />
   }
   return <SquawkView squawk={squawk.data} onChanged={squawk.reload} />
}

function SquawkView({ squawk, onChanged }: { squawk: SquawkDetail; onChanged: () => void }) {
   const label = `${squawk.siteKey} #${squawk.number}`
   return (
      <>
         <p className="breadcrumb">
            <Link to="/">Sites</Link> / <Link to={siteLink(squawk.siteKey)}>{squawk.siteKey}</Link>
         </p>
         <div className="page-header">
            <h1>
               #{squawk.number} <StatusChip status={squawk.status} />
            </h1>
            <StatusButton squawk={squawk} onChanged={onChanged} />
         </div>
         {squawk.screenshot === null ? (
            <p className="notice">No screenshot attached.</p>
         ) : (
            <ScreenshotWithPin
               screenshot={squawk.screenshot}
               anchor={squawk.anchor}
               label={label}
            />
         )}
         <div className="detail-columns">
            <section className="thread" aria-label="Thread">
               <ThreadEntry
                  author={squawk.author}
                  createdAt={squawk.createdAt}
                  body={squawk.body}
               />
               {squawk.comments.map(comment => (
                  <ThreadEntry
                     key={comment.id}
                     author={comment.author}
                     createdAt={comment.createdAt}
                     body={comment.body}
                  />
               ))}
               <ReplyForm squawkId={squawk.id} onSent={onChanged} />
            </section>
            <Metadata squawk={squawk} />
         </div>
      </>
   )
}

function StatusButton({ squawk, onChanged }: { squawk: SquawkDetail; onChanged: () => void }) {
   const [saving, setSaving] = useState(false)
   const [error, setError] = useState<string | null>(null)
   const nextStatus = squawk.status === "open" ? "resolved" : "open"

   async function toggle() {
      setSaving(true)
      setError(null)
      try {
         await updateSquawkStatus(squawk.id, nextStatus)
         onChanged()
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Updating the status failed.")
      } finally {
         setSaving(false)
      }
   }

   return (
      <div className="status-action">
         <button type="button" onClick={toggle} disabled={saving}>
            {nextStatus === "resolved" ? "Resolve" : "Reopen"}
         </button>
         {error !== null && (
            <span className="error-text" role="alert">
               {error}
            </span>
         )}
      </div>
   )
}

function ThreadEntry({
   author,
   createdAt,
   body
}: {
   author: AuthorValue
   createdAt: string
   body: string
}) {
   return (
      <article className="thread-entry">
         <header className="thread-entry-header">
            <Author author={author} showAvatar />
            <RelativeTime value={createdAt} />
         </header>
         <BodyText text={body} />
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

function ReplyForm({ squawkId, onSent }: { squawkId: string; onSent: () => void }) {
   const [body, setBody] = useState("")
   const [sending, setSending] = useState(false)
   const [error, setError] = useState<string | null>(null)

   async function send() {
      if (body.trim() === "" || sending) {
         return
      }
      setSending(true)
      setError(null)
      try {
         await addComment(squawkId, body)
         setBody("")
         onSent()
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Sending failed.")
      } finally {
         setSending(false)
      }
   }

   function submit(event: FormEvent) {
      event.preventDefault()
      void send()
   }

   function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
         event.preventDefault()
         void send()
      }
   }

   return (
      <form className="reply-form" onSubmit={submit}>
         <label htmlFor="reply">Reply</label>
         <textarea
            id="reply"
            rows={4}
            value={body}
            maxLength={LIMITS.bodyMaxLength}
            onChange={event => setBody(event.target.value)}
            onKeyDown={handleKeyDown}
         />
         <div className="reply-actions">
            <span className="muted">Cmd/Ctrl+Enter to send</span>
            <button type="submit" disabled={sending || body.trim() === ""}>
               Send
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

function Metadata({ squawk }: { squawk: SquawkDetail }) {
   const { meta } = squawk
   const viewport = meta.viewport ?? squawk.anchor?.viewport
   const rows: Array<[string, ReactNode]> = []

   if (meta.url !== undefined) {
      rows.push([
         "URL",
         isSafeHttpUrl(meta.url) ? (
            <a
               href={buildSquawkPageUrl(meta.url, squawk.id)}
               target="_blank"
               rel="noopener noreferrer"
               className="break"
            >
               {meta.url}
            </a>
         ) : (
            <span className="break">{meta.url}</span>
         )
      ])
   }
   if (meta.title !== undefined) {
      rows.push(["Title", meta.title])
   }
   rows.push(["Page", <span className="mono break">{squawk.page}</span>])
   if (meta.ref !== undefined) {
      rows.push(["Ref", <span className="mono">{meta.ref}</span>])
   }
   if (meta.appVersion !== undefined) {
      rows.push(["App version", meta.appVersion])
   }
   if (viewport !== undefined) {
      const ratio = meta.devicePixelRatio === undefined ? "" : ` @ ${meta.devicePixelRatio}x`
      rows.push(["Viewport", `${viewport.width} × ${viewport.height}${ratio}`])
   }
   if (meta.userAgent !== undefined) {
      rows.push(["User agent", <span title={meta.userAgent}>{truncate(meta.userAgent, 60)}</span>])
   }
   rows.push([
      "Created",
      <span>
         <Author author={squawk.author} /> <RelativeTime value={squawk.createdAt} />
      </span>
   ])
   rows.push([
      "Status",
      squawk.status === "resolved" && squawk.resolvedAt !== null ? (
         <span>
            Resolved <RelativeTime value={squawk.resolvedAt} />
            {squawk.resolvedBy !== null && (
               <>
                  {" by "}
                  <Author author={squawk.resolvedBy} />
               </>
            )}
         </span>
      ) : (
         <StatusChip status={squawk.status} />
      )
   ])
   for (const [key, value] of Object.entries(meta.extra ?? {})) {
      rows.push([key, String(value)])
   }

   return (
      <aside className="metadata" aria-label="Details">
         <dl>
            {rows.map(([term, description], index) => (
               <div key={index} className="metadata-row">
                  <dt>{term}</dt>
                  <dd>{description}</dd>
               </div>
            ))}
         </dl>
      </aside>
   )
}
