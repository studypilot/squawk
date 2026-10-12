import type { Author as AuthorValue } from "@squawk/shared"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userAuthor } from "../test-fetch"
import { Author, authorName } from "./author"

const delegated: AuthorValue = {
   ...userAuthor,
   agent: { tokenId: "0b6f3c1e-2d4a-4f5b-8c7d-9e0f1a2b3c4d", name: "CLI MiniMo.local" }
}

describe("Author", () => {
   it("shows a person by name with the email as tooltip", () => {
      render(<Author author={userAuthor} showAvatar />)
      expect(screen.getByText("Ada Lovelace").closest(".author")).toHaveProperty(
         "title",
         "ada@example.com"
      )
   })

   it("shows an agent writing on someone's behalf as the agent, not the person", () => {
      const { container } = render(<Author author={delegated} showAvatar />)
      expect(screen.getByText("Agent · for Ada")).toBeDefined()
      expect(screen.queryByText("Ada Lovelace")).toBeNull()
      expect(container.querySelector(".author")?.getAttribute("title")).toBe(
         "CLI MiniMo.local on behalf of ada@example.com"
      )
      expect(container.querySelector(".avatar-delegate")).not.toBeNull()
      expect(container.querySelector("img")).toBeNull()
   })

   it("falls back to the email when the person has no name", () => {
      expect(authorName({ ...delegated, name: null })).toBe("Agent · for ada@example.com")
   })
})
