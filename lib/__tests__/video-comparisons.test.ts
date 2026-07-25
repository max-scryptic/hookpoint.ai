import { describe, expect, it } from "vitest"

import { isSamePair } from "@/lib/video-comparisons"

describe("isSamePair", () => {
  it("matches an identical ordered pair", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "x", b: "y" })).toBe(true)
  })

  it("matches a swapped pair - a comparison is unordered", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "y", b: "x" })).toBe(true)
  })

  it("does not match a different pair", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "x", b: "z" })).toBe(false)
    expect(isSamePair({ a: "x", b: "y" }, { a: "p", b: "q" })).toBe(false)
  })
})
