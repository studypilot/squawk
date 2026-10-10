import type { Anchor, SquawkDetail } from "@squawk/shared"
import { type CommandContext, connect, printJson, printLine } from "../context"
import { authorLabel, displayRef, relativeTime } from "../format"
import { resolveRef } from "../refs"

export async function showCommand(
   context: CommandContext,
   ref: string,
   options: { site?: string }
): Promise<void> {
   const apiRef = resolveRef(ref, options.site)
   const client = await connect(context)
   const detail = await client.getSquawk(apiRef)
   if (context.json) return printJson(context, detail)
   printLine(context, renderDetail(detail, context.now()))
}

function renderDetail(detail: SquawkDetail, now: Date): string {
   const lines = [`${detail.siteKey}#${detail.number}  [${detail.status}]  ${detail.id}`, ""]
   const field = (label: string, value: string | undefined): void => {
      if (value !== undefined && value !== "") lines.push(`${`${label}:`.padEnd(11)}${value}`)
   }
   field("Page", detail.page)
   field("URL", detail.meta.url)
   field("Title", detail.meta.title)
   field("Ref", detail.meta.ref)
   field("Version", detail.meta.appVersion)
   field("Viewport", formatViewport(detail))
   field("Anchor", detail.anchor === null ? undefined : formatAnchor(detail.anchor))
   field("Author", `${authorLabel(detail.author)}, ${relativeTime(detail.createdAt, now)}`)
   if (detail.resolvedAt !== null) {
      const resolver = detail.resolvedBy === null ? "" : ` by ${authorLabel(detail.resolvedBy)}`
      field("Resolved", `${relativeTime(detail.resolvedAt, now)}${resolver}`)
   }

   lines.push("", detail.body)

   const replies = detail.comments
   if (replies.length > 0) {
      lines.push("", `Replies (${replies.length}):`)
      for (const comment of replies) {
         lines.push("", `  ${authorLabel(comment.author)}, ${relativeTime(comment.createdAt, now)}`)
         lines.push(...comment.body.split("\n").map(line => `    ${line}`))
      }
   }

   lines.push("")
   if (detail.screenshot === null) {
      lines.push("No screenshot.")
   } else {
      const { width, height, source } = detail.screenshot
      lines.push(
         `Screenshot: ${width}×${height} (${source}). Download with: ` +
            `squawk screenshot ${displayRef(detail.siteKey, detail.number)}`
      )
   }
   return lines.join("\n")
}

function formatViewport(detail: SquawkDetail): string | undefined {
   const viewport = detail.meta.viewport ?? detail.anchor?.viewport
   if (viewport === undefined) return undefined
   const ratio = detail.meta.devicePixelRatio
   return `${viewport.width}×${viewport.height}${ratio === undefined ? "" : ` @${ratio}x`}`
}

function formatAnchor(anchor: Anchor): string {
   const { selectors } = anchor
   const parts = [`<${selectors.tagName}>`]
   if (selectors.testId !== undefined) parts.push(`testId=${selectors.testId}`)
   if (selectors.css !== undefined) parts.push(`css=${selectors.css}`)
   if (selectors.text !== undefined) parts.push(`text="${selectors.text.exact}"`)
   return parts.join("  ")
}
