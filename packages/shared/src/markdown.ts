/**
 * A small Markdown renderer for squawk bodies and replies, shared by the overlay and the inbox.
 *
 * The output is safe by construction: every piece of source text is HTML-escaped, only a fixed
 * set of tags is emitted, raw HTML is never passed through, and links only get an `href` when the
 * URL parses with an allowed protocol. Callers may therefore assign the result to `innerHTML`.
 *
 * Supported: paragraphs (single newlines become `<br>`), `**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``, fenced code blocks, `#`–`###` headings, bullet and numbered lists (nested by
 * indentation), `>` quotes, `[text](url)` links, bare http(s) URLs, `---` rules and backslash
 * escapes. Everything runs in linear time, so long or hostile input cannot stall a page.
 */
export function renderMarkdown(source: string): string {
   const normalized = source.replace(/\r\n?/g, "\n").replace(/^\t+/gm, expandTabs)
   return renderBlocks(normalized.split("\n"), 0)
}

/** The first non-empty line of the rendered text, without any Markdown syntax; for list rows. */
export function markdownPreview(source: string): string {
   const text = renderMarkdown(source)
      .replace(/<br>|<hr>|<\/(?:p|h1|h2|h3|li|pre|blockquote)>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITY_TEXT[entity] ?? entity)
   const line = text.split("\n").find(candidate => candidate.trim() !== "")
   return line === undefined ? "" : line.trim()
}

const ENTITY_TEXT: Record<string, string> = {
   "&amp;": "&",
   "&lt;": "<",
   "&gt;": ">",
   "&quot;": '"',
   "&#39;": "'"
}

/** Quotes and lists nest at most this deep; deeper markers are rendered as text. */
const MAX_NESTING_DEPTH = 6
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const AUTOLINK_PROTOCOLS = new Set(["http:", "https:"])
const LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"'

function expandTabs(tabs: string): string {
   return "    ".repeat(tabs.length)
}

function escapeHtml(text: string): string {
   return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
}

function safeHref(value: string, protocols: ReadonlySet<string>): string | null {
   try {
      const url = new URL(value)
      return protocols.has(url.protocol) ? url.href : null
   } catch {
      return null
   }
}

function link(href: string, html: string): string {
   return `<a href="${escapeHtml(href)}" ${LINK_ATTRIBUTES}>${html}</a>`
}

// ---- blocks --------------------------------------------------------------------------------

const FENCE_PATTERN = /^ {0,3}(`{3,})([^`]*)$/
const HEADING_PATTERN = /^ {0,3}(#{1,3})(?: |$)/
const RULE_PATTERN = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
const QUOTE_PATTERN = /^ {0,3}> ?/
const LIST_ITEM_PATTERN = /^( {0,3})([-*+]|\d{1,9}\.)( +|$)/
const LANGUAGE_PATTERN = /^[a-z0-9+-]+$/
/** Indentation that puts a line inside the list item above it. */
const LIST_CONTINUATION_INDENT = 2

interface ListMarker {
   ordered: boolean
   start: number
   /** Characters before the item text: indentation, marker and the spaces after it. */
   width: number
}

function listMarker(line: string): ListMarker | null {
   const match = LIST_ITEM_PATTERN.exec(line)
   if (!match) return null
   const [whole, , marker = ""] = match
   const ordered = marker.length > 1 || /\d/.test(marker)
   return { ordered, start: ordered ? Number.parseInt(marker, 10) : 1, width: whole.length }
}

function indentation(line: string): number {
   let count = 0
   while (line.charCodeAt(count) === 32) count++
   return count
}

function isBlank(line: string): boolean {
   return line.trim() === ""
}

/** Whether the line starts a block of its own and therefore ends a running paragraph. */
function startsBlock(line: string, depth: number): boolean {
   if (FENCE_PATTERN.test(line) || HEADING_PATTERN.test(line) || RULE_PATTERN.test(line)) {
      return true
   }
   if (depth >= MAX_NESTING_DEPTH) return false
   return QUOTE_PATTERN.test(line) || listMarker(line) !== null
}

function renderBlocks(lines: string[], depth: number): string {
   const blocks: string[] = []
   let index = 0
   while (index < lines.length) {
      const line = lines[index] ?? ""
      if (isBlank(line)) {
         index++
         continue
      }

      const fence = FENCE_PATTERN.exec(line)
      if (fence) {
         const [, ticks = "", info = ""] = fence
         const code: string[] = []
         index++
         while (index < lines.length && !isClosingFence(lines[index] ?? "", ticks.length)) {
            code.push(lines[index] ?? "")
            index++
         }
         index++
         const language = info.trim().split(/\s/)[0] ?? ""
         const languageClass = LANGUAGE_PATTERN.test(language)
            ? ` class="language-${language}"`
            : ""
         blocks.push(`<pre><code${languageClass}>${escapeHtml(code.join("\n"))}</code></pre>`)
         continue
      }

      const heading = HEADING_PATTERN.exec(line)
      if (heading) {
         const level = heading[1]?.length ?? 1
         const text = stripClosingHashes(line.slice(heading[0].length).trim())
         blocks.push(`<h${level}>${renderInline(text, true)}</h${level}>`)
         index++
         continue
      }

      if (RULE_PATTERN.test(line)) {
         blocks.push("<hr>")
         index++
         continue
      }

      if (depth < MAX_NESTING_DEPTH && QUOTE_PATTERN.test(line)) {
         const quoted: string[] = []
         while (index < lines.length && QUOTE_PATTERN.test(lines[index] ?? "")) {
            quoted.push((lines[index] ?? "").replace(QUOTE_PATTERN, ""))
            index++
         }
         blocks.push(`<blockquote>${renderBlocks(quoted, depth + 1)}</blockquote>`)
         continue
      }

      const marker = depth < MAX_NESTING_DEPTH ? listMarker(line) : null
      if (marker) {
         const list = renderList(lines, index, marker, depth)
         blocks.push(list.html)
         index = list.next
         continue
      }

      const paragraph: string[] = [line.trim()]
      index++
      while (index < lines.length) {
         const next = lines[index] ?? ""
         if (isBlank(next) || startsBlock(next, depth)) break
         paragraph.push(next.trim())
         index++
      }
      blocks.push(`<p>${renderInline(paragraph.join("\n"), true)}</p>`)
   }
   return blocks.join("\n")
}

function isClosingFence(line: string, openingLength: number): boolean {
   const trimmed = line.trim()
   return trimmed.length >= openingLength && /^`+$/.test(trimmed) && indentation(line) <= 3
}

/** `## Title ##` → `Title`; hashes glued to the text (`C#`) stay. */
function stripClosingHashes(text: string): string {
   let end = text.length
   while (end > 0 && text[end - 1] === "#") end--
   if (end === text.length) return text
   if (end === 0) return ""
   return text[end - 1] === " " ? text.slice(0, end).trimEnd() : text
}

/**
 * Collects consecutive items of one list kind. Lines indented by two or more spaces belong to the
 * item above (continuation text or a nested list); a blank line only ends the list when the next
 * line neither continues the item nor starts another one.
 */
function renderList(
   lines: string[],
   start: number,
   first: ListMarker,
   depth: number
): { html: string; next: number } {
   const items: string[] = []
   let index = start
   let marker: ListMarker | null = first
   while (marker && marker.ordered === first.ordered) {
      const itemLines = [(lines[index] ?? "").slice(marker.width)]
      index++
      while (index < lines.length) {
         const next = lines[index] ?? ""
         if (isBlank(next)) {
            const following = lines[index + 1] ?? ""
            if (isBlank(following) || indentation(following) < LIST_CONTINUATION_INDENT) break
            itemLines.push("")
            index++
            continue
         }
         const indent = indentation(next)
         if (indent < LIST_CONTINUATION_INDENT) break
         itemLines.push(next.slice(Math.min(indent, marker.width)))
         index++
      }
      items.push(`<li>${unwrapSingleParagraph(renderBlocks(itemLines, depth + 1))}</li>`)

      let lookahead = index
      while (lookahead < lines.length && isBlank(lines[lookahead] ?? "")) lookahead++
      marker = lookahead < lines.length ? listMarker(lines[lookahead] ?? "") : null
      if (marker && marker.ordered === first.ordered) index = lookahead
   }
   const tag = first.ordered ? "ol" : "ul"
   const startAttribute = first.ordered && first.start !== 1 ? ` start="${first.start}"` : ""
   return { html: `<${tag}${startAttribute}>${items.join("")}</${tag}>`, next: index }
}

function unwrapSingleParagraph(html: string): string {
   if (!html.startsWith("<p>") || !html.endsWith("</p>")) return html
   const inner = html.slice(3, -4)
   return inner.includes("<p>") ? html : inner
}

// ---- inline --------------------------------------------------------------------------------

/** An emphasis delimiter run (`*`, `_` or `~~`) waiting for a partner. */
interface Delimiter {
   character: string
   /** Characters of the run not consumed by a match; they are printed literally. */
   count: number
   /** Tags emitted after the remaining characters, innermost last. */
   openTags: string
   /** Tags emitted before the remaining characters, innermost first. */
   closeTags: string
}

const ESCAPABLE = /^[!-/:-@[-`{-~]$/
const PUNCTUATION = /[\p{P}\p{S}]/u
const WHITESPACE = /\s/
const WORD_CHARACTER = /[\p{L}\p{N}]/u
const URL_STOP = /[\s<>"`]/
const URL_TRAILING_PUNCTUATION = ".,;:!?)]'*_~"

function isWhitespace(character: string): boolean {
   return character === "" || WHITESPACE.test(character)
}

function isPunctuation(character: string): boolean {
   return character !== "" && PUNCTUATION.test(character)
}

/**
 * Inline formatting of one paragraph or heading. Code spans and links are atomic; emphasis is
 * matched with a delimiter stack in one pass. `allowLinks` is false inside link text.
 */
function renderInline(text: string, allowLinks: boolean): string {
   const nodes: Array<string | Delimiter> = []
   const stack: Delimiter[] = []
   /** Per character: stack length below which no opener for that character can exist. */
   const openersBottom: Record<string, number> = {}
   const backtickRuns = new Map<number, { from: number; at: number }>()
   let bracketSearch = { from: -1, at: -1 }
   let plain = ""
   let index = 0

   const flush = (): void => {
      if (!plain) return
      nodes.push(escapeHtml(plain).replace(/\n/g, "<br>"))
      plain = ""
   }

   /** Start of the next run of exactly `length` backticks at or after `from`, or -1. */
   const findBacktickRun = (from: number, length: number): number => {
      const cached = backtickRuns.get(length)
      if (cached && cached.from <= from && (cached.at === -1 || cached.at >= from)) {
         return cached.at
      }
      let position = from
      let found = -1
      while (position < text.length) {
         const next = text.indexOf("`", position)
         if (next === -1) break
         let end = next
         while (text[end] === "`") end++
         if (end - next === length) {
            found = next
            break
         }
         position = end
      }
      backtickRuns.set(length, { from, at: found })
      return found
   }

   /** Position of the next unescaped `]` at or after `from`, or -1. */
   const findClosingBracket = (from: number): number => {
      if (bracketSearch.from !== -1 && bracketSearch.from <= from) {
         if (bracketSearch.at === -1 || bracketSearch.at >= from) return bracketSearch.at
      }
      let position = from
      let found = -1
      while (position < text.length) {
         const character = text[position]
         if (character === "\\") {
            position += 2
            continue
         }
         if (character === "]") {
            found = position
            break
         }
         position++
      }
      bracketSearch = { from, at: found }
      return found
   }

   const tryLink = (): boolean => {
      const close = findClosingBracket(index + 1)
      if (close === -1 || text[close + 1] !== "(") return false
      let position = close + 2
      let depth = 0
      while (position < text.length) {
         const character = text[position] ?? ""
         // Stopping at `[` keeps the scans of different link attempts disjoint, hence linear.
         if (isWhitespace(character) || character === "[") return false
         if (character === "(") depth++
         if (character === ")") {
            if (depth === 0) break
            depth--
         }
         position++
      }
      if (text[position] !== ")") return false
      const label = renderInline(text.slice(index + 1, close), false)
      const href = safeHref(text.slice(close + 2, position), LINK_PROTOCOLS)
      flush()
      nodes.push(href ? link(href, label) : label)
      index = position + 1
      return true
   }

   const tryAutolink = (): boolean => {
      if (!text.startsWith("http://", index) && !text.startsWith("https://", index)) return false
      if (WORD_CHARACTER.test(text[index - 1] ?? "")) return false
      let end = index
      while (end < text.length && !URL_STOP.test(text[end] ?? "")) end++
      while (end > index && URL_TRAILING_PUNCTUATION.includes(text[end - 1] ?? "")) end--
      const url = text.slice(index, end)
      const href = safeHref(url, AUTOLINK_PROTOCOLS)
      if (!href) return false
      flush()
      nodes.push(link(href, escapeHtml(url)))
      index = end
      return true
   }

   const matchEmphasis = (closer: Delimiter): void => {
      const bottom = openersBottom[closer.character] ?? 0
      while (closer.count > 0) {
         let openerIndex = stack.length - 1
         while (openerIndex >= bottom && stack[openerIndex]?.character !== closer.character) {
            openerIndex--
         }
         const opener = openerIndex >= bottom ? stack[openerIndex] : undefined
         if (!opener) {
            openersBottom[closer.character] = stack.length
            return
         }
         const used = closer.character === "~" ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1
         const tag = closer.character === "~" ? "del" : used === 2 ? "strong" : "em"
         opener.count -= used
         closer.count -= used
         opener.openTags = `<${tag}>${opener.openTags}`
         closer.closeTags = `${closer.closeTags}</${tag}>`
         stack.length = opener.count > 0 ? openerIndex + 1 : openerIndex
         for (const key of Object.keys(openersBottom)) {
            openersBottom[key] = Math.min(openersBottom[key] ?? 0, stack.length)
         }
      }
   }

   const pushDelimiter = (character: string, length: number): void => {
      const before = text[index - 1] ?? ""
      const after = text[index + length] ?? ""
      const leftFlanking =
         !isWhitespace(after) &&
         (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before))
      const rightFlanking =
         !isWhitespace(before) &&
         (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after))
      const underscore = character === "_"
      const canOpen = leftFlanking && (!underscore || !rightFlanking || isPunctuation(before))
      const canClose = rightFlanking && (!underscore || !leftFlanking || isPunctuation(after))
      flush()
      const delimiter: Delimiter = { character, count: length, openTags: "", closeTags: "" }
      nodes.push(delimiter)
      if (canClose) matchEmphasis(delimiter)
      if (canOpen && delimiter.count > 0) stack.push(delimiter)
      index += length
   }

   while (index < text.length) {
      const character = text[index] ?? ""

      if (character === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
         plain += text[index + 1]
         index += 2
         continue
      }

      if (character === "`") {
         let end = index
         while (text[end] === "`") end++
         const length = end - index
         const closing = findBacktickRun(end, length)
         if (closing === -1) {
            plain += text.slice(index, end)
            index = end
            continue
         }
         let code = text.slice(end, closing).replace(/\n/g, " ")
         if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
            code = code.slice(1, -1)
         }
         flush()
         nodes.push(`<code>${escapeHtml(code)}</code>`)
         index = closing + length
         continue
      }

      if (character === "[" && allowLinks && tryLink()) continue
      if (character === "h" && allowLinks && tryAutolink()) continue

      if (character === "*" || character === "_" || character === "~") {
         let end = index
         while (text[end] === character) end++
         const length = end - index
         if (character !== "~" || length === 2) {
            pushDelimiter(character, length)
            continue
         }
         plain += text.slice(index, end)
         index = end
         continue
      }

      plain += character
      index++
   }
   flush()

   return nodes
      .map(node => {
         if (typeof node === "string") return node
         return `${node.closeTags}${node.character.repeat(node.count)}${node.openTags}`
      })
      .join("")
}
