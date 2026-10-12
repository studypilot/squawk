import { describe, expect, it } from "vitest"
import { markdownPreview, renderMarkdown } from "./markdown"

const LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"'

function anchor(href: string, text: string): string {
   return `<a href="${href}" ${LINK_ATTRIBUTES}>${text}</a>`
}

describe("renderMarkdown blocks", () => {
   it("renders nothing for empty or blank input", () => {
      expect(renderMarkdown("")).toBe("")
      expect(renderMarkdown("  \n\n \t\n")).toBe("")
   })

   it("separates paragraphs by blank lines and keeps single line breaks", () => {
      expect(renderMarkdown("one\ntwo\n\n\nthree\n")).toBe("<p>one<br>two</p>\n<p>three</p>")
   })

   it("treats Windows and old Mac line endings like newlines", () => {
      expect(renderMarkdown("a\r\nb\r\n\r\nc\rd")).toBe("<p>a<br>b</p>\n<p>c<br>d</p>")
   })

   it("renders headings up to level three", () => {
      expect(renderMarkdown("# One\n## Two\n### Three")).toBe(
         "<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>"
      )
   })

   it("strips closing hashes but keeps hashes that belong to the text", () => {
      expect(renderMarkdown("## Title ##")).toBe("<h2>Title</h2>")
      expect(renderMarkdown("## C#")).toBe("<h2>C#</h2>")
   })

   it("leaves deeper headings and hashtags as text", () => {
      expect(renderMarkdown("#### Four")).toBe("<p>#### Four</p>")
      expect(renderMarkdown("#hashtag")).toBe("<p>#hashtag</p>")
   })

   it("formats inline content inside headings", () => {
      expect(renderMarkdown("# A **b** `c`")).toBe("<h1>A <strong>b</strong> <code>c</code></h1>")
   })

   it("renders a fenced code block with an escaped body and a language class", () => {
      expect(renderMarkdown("```ts\nconst a = <b> && 'c'\n  indented\n```")).toBe(
         '<pre><code class="language-ts">const a = &lt;b&gt; &amp;&amp; &#39;c&#39;\n  indented</code></pre>'
      )
   })

   it("drops language names outside the allowed character set", () => {
      expect(renderMarkdown('```"><script>\nx\n```')).toBe("<pre><code>x</code></pre>")
      expect(renderMarkdown("```TypeScript\nx\n```")).toBe("<pre><code>x</code></pre>")
      expect(renderMarkdown("```c++ extra words\nx\n```")).toBe(
         '<pre><code class="language-c++">x</code></pre>'
      )
   })

   it("does not format anything inside a code block", () => {
      expect(renderMarkdown("```\n**not bold** [x](https://a.b) # no\n```")).toBe(
         "<pre><code>**not bold** [x](https://a.b) # no</code></pre>"
      )
   })

   it("runs an unterminated fence to the end of the text", () => {
      expect(renderMarkdown("before\n```\ncode\nmore")).toBe(
         "<p>before</p>\n<pre><code>code\nmore</code></pre>"
      )
   })

   it("only closes a fence with at least as many backticks", () => {
      expect(renderMarkdown("````\n```\n````")).toBe("<pre><code>```</code></pre>")
   })

   it("renders bullet lists with every marker", () => {
      expect(renderMarkdown("- a\n* b\n+ c")).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>")
   })

   it("renders ordered lists and keeps the start number", () => {
      expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>")
      expect(renderMarkdown("3. c\n4. d")).toBe('<ol start="3"><li>c</li><li>d</li></ol>')
   })

   it("nests lists indented by two or more spaces", () => {
      expect(renderMarkdown("- a\n  - b\n    - c\n- d")).toBe(
         "<ul><li><p>a</p>\n<ul><li><p>b</p>\n<ul><li>c</li></ul></li></ul></li><li>d</li></ul>"
      )
      expect(renderMarkdown("1. a\n   - b")).toBe("<ol><li><p>a</p>\n<ul><li>b</li></ul></li></ol>")
   })

   it("keeps indented lines inside the item and lets a list interrupt a paragraph", () => {
      expect(renderMarkdown("Steps:\n- one\n  still one\n- two")).toBe(
         "<p>Steps:</p>\n<ul><li>one<br>still one</li><li>two</li></ul>"
      )
   })

   it("continues a list across blank lines and ends it at other text", () => {
      expect(renderMarkdown("- a\n\n- b\n\nafter")).toBe(
         "<ul><li>a</li><li>b</li></ul>\n<p>after</p>"
      )
   })

   it("starts a new list when the marker kind changes", () => {
      expect(renderMarkdown("- a\n1. b")).toBe("<ul><li>a</li></ul>\n<ol><li>b</li></ol>")
   })

   it("renders block quotes with nested content", () => {
      expect(renderMarkdown("> quote **x**\n> more\n>\n> - item\n\nafter")).toBe(
         "<blockquote><p>quote <strong>x</strong><br>more</p>\n<ul><li>item</li></ul></blockquote>\n<p>after</p>"
      )
   })

   it("renders horizontal rules", () => {
      expect(renderMarkdown("a\n---\nb\n\n***")).toBe("<p>a</p>\n<hr>\n<p>b</p>\n<hr>")
   })

   it("expands leading tabs so tab-indented items nest", () => {
      expect(renderMarkdown("- a\n\t- b")).toBe("<ul><li><p>a</p>\n<ul><li>b</li></ul></li></ul>")
   })
})

describe("renderMarkdown inline", () => {
   it("renders bold, italic and strikethrough", () => {
      expect(renderMarkdown("**b** __b__ *i* _i_ ~~s~~")).toBe(
         "<p><strong>b</strong> <strong>b</strong> <em>i</em> <em>i</em> <del>s</del></p>"
      )
   })

   it("nests emphasis", () => {
      expect(renderMarkdown("***both*** **a *b* c**")).toBe(
         "<p><em><strong>both</strong></em> <strong>a <em>b</em> c</strong></p>"
      )
   })

   it("keeps underscores inside words literal", () => {
      expect(renderMarkdown("snake_case_name and _real_")).toBe(
         "<p>snake_case_name and <em>real</em></p>"
      )
   })

   it("leaves unmatched and space-surrounded markers as text", () => {
      expect(renderMarkdown("2 * 3 * 4, **open, ~single~")).toBe(
         "<p>2 * 3 * 4, **open, ~single~</p>"
      )
   })

   it("renders inline code without formatting inside", () => {
      expect(renderMarkdown("`**not bold** <b>` and ``a ` b``")).toBe(
         "<p><code>**not bold** &lt;b&gt;</code> and <code>a ` b</code></p>"
      )
   })

   it("keeps an unclosed backtick literal", () => {
      expect(renderMarkdown("a ` b")).toBe("<p>a ` b</p>")
   })

   it("does not let emphasis cross a code span", () => {
      expect(renderMarkdown("*a `*` b*")).toBe("<p><em>a <code>*</code> b</em></p>")
   })

   it("turns escaped markers into literal characters", () => {
      expect(renderMarkdown("\\*not\\* \\_x\\_ \\` \\[a](b) \\\\")).toBe(
         "<p>*not* _x_ ` [a](b) \\</p>"
      )
   })

   it("escapes HTML instead of passing it through", () => {
      expect(renderMarkdown("<script>alert('x')</script> & <b onclick=\"y\">")).toBe(
         "<p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &lt;b onclick=&quot;y&quot;&gt;</p>"
      )
   })

   it("prints entities literally", () => {
      expect(renderMarkdown("&amp; &lt;")).toBe("<p>&amp;amp; &amp;lt;</p>")
   })
})

describe("renderMarkdown links", () => {
   it("renders http, https and mailto links", () => {
      expect(renderMarkdown("[a](https://example.com/x?y=1&z=2) [m](mailto:me@example.com)")).toBe(
         `<p>${anchor("https://example.com/x?y=1&amp;z=2", "a")} ${anchor("mailto:me@example.com", "m")}</p>`
      )
   })

   it("formats the link text but never nests links", () => {
      expect(renderMarkdown("[**bold** https://inner.example](https://example.com)")).toBe(
         `<p>${anchor("https://example.com/", "<strong>bold</strong> https://inner.example")}</p>`
      )
   })

   it.each([
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,hi",
      "vbscript:x",
      "/relative/path",
      "not a url"
   ])("drops %s to plain link text", url => {
      expect(renderMarkdown(`[click](${url})`)).not.toContain("<a")
   })

   it("keeps the text of a dropped javascript link", () => {
      expect(renderMarkdown("[click](javascript:alert(1)) after")).toBe("<p>click after</p>")
   })

   it("escapes quotes in hrefs", () => {
      expect(renderMarkdown('[x](https://example.com/"onmouseover="a)')).toBe(
         `<p>${anchor("https://example.com/%22onmouseover=%22a", "x")}</p>`
      )
   })

   it("leaves brackets without a directly following URL alone", () => {
      expect(renderMarkdown("[x] [z] (https://example.com)")).toBe(
         `<p>[x] [z] (${anchor("https://example.com/", "https://example.com")})</p>`
      )
   })

   it("renders an empty URL as plain link text", () => {
      expect(renderMarkdown("[y]()")).toBe("<p>y</p>")
   })

   it("autolinks bare URLs and leaves trailing punctuation outside", () => {
      expect(renderMarkdown("See https://example.com/a?b=1. Or (http://x.dev/p), ok!")).toBe(
         `<p>See ${anchor("https://example.com/a?b=1", "https://example.com/a?b=1")}. Or (${anchor(
            "http://x.dev/p",
            "http://x.dev/p"
         )}), ok!</p>`
      )
      expect(renderMarkdown("https://a.dev/x;:!?")).toBe(
         `<p>${anchor("https://a.dev/x", "https://a.dev/x")};:!?</p>`
      )
   })

   it("autolinks inside emphasis without swallowing the markers", () => {
      expect(renderMarkdown("**https://a.dev**")).toBe(
         `<p><strong>${anchor("https://a.dev/", "https://a.dev")}</strong></p>`
      )
   })

   it("does not autolink inside words, code or other protocols", () => {
      expect(renderMarkdown("xhttps://a.dev `https://b.dev` ftp://c.dev")).toBe(
         "<p>xhttps://a.dev <code>https://b.dev</code> ftp://c.dev</p>"
      )
   })
})

describe("renderMarkdown performance", () => {
   it.each([
      ["plain text", "word ".repeat(20_000)],
      ["asterisks", "*a".repeat(50_000)],
      ["underscores", "_a ".repeat(34_000)],
      ["mixed delimiters", "**_~~".repeat(20_000)],
      ["backticks", "`a``".repeat(25_000)],
      ["brackets", "[".repeat(100_000)],
      ["broken links", "[a](b".repeat(20_000)],
      ["quotes", "> ".repeat(50_000)],
      ["list markers", "- ".repeat(50_000)],
      ["nested items", "- x\n  ".repeat(16_000)],
      ["fence with spaces", "```" + " ".repeat(100_000) + "`"],
      ["heading with spaces", "# " + " ".repeat(100_000) + "x"],
      ["URLs", "https://".repeat(12_500)]
   ])("renders 100 kB of %s quickly", (_, source) => {
      const started = performance.now()
      renderMarkdown(source)
      expect(performance.now() - started).toBeLessThan(500)
   })
})

describe("markdownPreview", () => {
   it("returns the first line of text without Markdown syntax", () => {
      expect(markdownPreview("\n\n# The **title** & `code`\n\nBody")).toBe("The title & code")
   })

   it("ends at the first line break", () => {
      expect(markdownPreview("first [link](https://a.dev)\nsecond")).toBe("first link")
   })

   it("shows the first item of a list or quote", () => {
      expect(markdownPreview("- one\n- two")).toBe("one")
      expect(markdownPreview("> quoted *text*")).toBe("quoted text")
   })

   it("keeps characters that look like HTML", () => {
      expect(markdownPreview("<script>x</script> \"q\" 'a'")).toBe("<script>x</script> \"q\" 'a'")
   })

   it("returns an empty string for empty input", () => {
      expect(markdownPreview("")).toBe("")
      expect(markdownPreview("---")).toBe("")
   })
})
