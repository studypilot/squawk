import { describe, expect, it } from "vitest"
import { workingDuration } from "./format"

describe("workingDuration", () => {
   const since = "2026-10-10T12:00:00.000Z"
   const at = (minutes: number): number => new Date(since).getTime() + minutes * 60_000

   it.each([
      [0.5, "just now"],
      [4, "4 min"],
      [59, "59 min"],
      [60, "1 h"],
      [150, "2 h"],
      [60 * 24 * 3, "3 d"]
   ])("after %s minutes reads %s", (minutes, label) => {
      expect(workingDuration(since, at(minutes))).toBe(label)
   })
})
