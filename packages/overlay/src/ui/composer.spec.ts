import { afterEach, describe, expect, it, vi } from "vitest"
import type { Anchor } from "@squawk/shared"
import { createComposer } from "./composer"
import type { ComposerOptions } from "./composer"

const ANCHOR: Anchor = {
   version: 1,
   selectors: { tagName: "button" },
   rect: { x: 0.5, y: 0.5 },
   page: { x: 100, y: 100, scrollX: 0, scrollY: 0 },
   elementBox: { x: 80, y: 90, width: 40, height: 20 },
   viewport: { width: 1280, height: 800 }
}

const AREA_ANCHOR: Anchor = {
   ...ANCHOR,
   rect: { x: 0.1, y: 0.2 },
   page: { x: 100, y: 200, scrollX: 0, scrollY: 0 },
   elementBox: { x: 0, y: 0, width: 1000, height: 1000 },
   area: { x: 100, y: 200, width: 300, height: 150 }
}

function setup(
   submit: ComposerOptions["submit"] = vi.fn(async () => undefined),
   options: Partial<ComposerOptions> = {}
) {
   const close = vi.fn()
   const composer = createComposer({ anchor: ANCHOR, screenshot: null, submit, close, ...options })
   document.body.append(composer.element)
   const textarea = composer.element.querySelector("textarea")
   if (!textarea) throw new Error("textarea missing")
   const press = (key: string, init: KeyboardEventInit = {}): void => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }))
   }
   return { composer, textarea, press, submit, close }
}

afterEach(() => {
   document.body.innerHTML = ""
})

describe("composer", () => {
   it("adds to the review with Enter, not with Shift+Enter", async () => {
      const { textarea, press, submit, close } = setup()
      textarea.value = "Too tight"
      press("Enter", { shiftKey: true })
      expect(submit).not.toHaveBeenCalled()

      press("Enter")
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
      expect(submit).toHaveBeenCalledWith("Too tight", "draft")
   })

   it.each([{ metaKey: true }, { ctrlKey: true }])("sends now with %o+Enter", async modifier => {
      const { textarea, press, submit } = setup()
      textarea.value = "Too tight"
      press("Enter", modifier)
      await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("Too tight", "now"))
   })

   it("offers Send now as a button", async () => {
      const { composer, textarea, submit } = setup()
      textarea.value = "Ship it"
      composer.element.querySelector<HTMLButtonElement>(".send-now")?.click()
      await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("Ship it", "now"))
   })

   it("disables itself while sending and shows errors inline", async () => {
      let fail: (error: Error) => void = () => undefined
      const submit = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)))
      const { composer, textarea, press, close } = setup(submit)
      textarea.value = "Hello"
      press("Enter")
      expect(textarea.disabled).toBe(true)
      press("Enter")
      expect(submit).toHaveBeenCalledOnce()

      fail(new Error("Server down"))
      await vi.waitFor(() =>
         expect(composer.element.querySelector(".error")?.textContent).toBe("Server down")
      )
      expect(textarea.disabled).toBe(false)
      expect(close).not.toHaveBeenCalled()
   })

   it("outlines the area on the page and on the screenshot preview", () => {
      const screenshot = {
         blob: new Blob(),
         previewUrl: "blob:preview",
         width: 2560,
         height: 1600,
         devicePixelRatio: 2,
         source: "extension" as const
      }
      const { composer } = setup(undefined, { anchor: AREA_ANCHOR, screenshot })
      const onPage = composer.element.querySelector<HTMLElement>(".composer-area")
      expect(onPage?.style.left).toBe("100px")
      expect(onPage?.style.top).toBe("200px")
      expect(onPage?.style.width).toBe("300px")
      expect(onPage?.style.height).toBe("150px")
      expect(composer.element.querySelector(".composer-pin")).not.toBeNull()
      expect(composer.element.querySelector(".composer-shot .marker-area")).not.toBeNull()
      expect(composer.element.querySelector(".composer-shot .marker")).toBeNull()
   })

   it("marks a point squawk with a dot, not an outline", () => {
      const { composer } = setup()
      expect(composer.element.querySelector(".composer-area")).toBeNull()
   })

   it("closes with Escape and has no Markdown hint", () => {
      const { composer, press, close } = setup()
      press("Escape")
      expect(close).toHaveBeenCalledOnce()
      expect(composer.element.textContent).not.toContain("Markdown")
   })
})
