import { describe, expect, it } from "vitest"

import { preferredViewCount } from "@/lib/youtube/youtube"

describe("preferredViewCount", () => {
  it("prefers YouTube's public counter over the lagging Analytics figure", () => {
    expect(preferredViewCount({ viewCount: 186 }, { views: 174 })).toBe(186)
  })

  it("falls back to the Analytics figure when no counter is stored", () => {
    expect(preferredViewCount({ viewCount: null }, { views: 174 })).toBe(174)
    expect(preferredViewCount(null, { views: 174 })).toBe(174)
    expect(preferredViewCount(undefined, { views: 174 })).toBe(174)
  })

  it("keeps a real zero rather than falling through to the other source", () => {
    expect(preferredViewCount({ viewCount: 0 }, { views: 174 })).toBe(0)
  })

  it("is null when neither source has a number", () => {
    expect(preferredViewCount(null, null)).toBeNull()
    expect(preferredViewCount({ viewCount: null }, { views: null })).toBeNull()
  })
})
