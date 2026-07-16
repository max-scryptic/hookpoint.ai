import { describe, expect, it } from "vitest"

import { isPackagingTaxonomyOutput } from "@/lib/packaging-taxonomy"

const valid = {
  titleStyles: ["curiosity_gap"],
  thumbnailHasFace: true,
  thumbnailEmotion: "excited",
  thumbnailTextWordCount: 3,
  promiseType: "transformation",
  hookDelivery: "direct",
  alignmentScore: 0.8,
  topics: ["gear reviews"],
}

describe("isPackagingTaxonomyOutput", () => {
  it("accepts a well-formed model output, including the faceless sentinel", () => {
    expect(isPackagingTaxonomyOutput(valid)).toBe(true)
    expect(
      isPackagingTaxonomyOutput({
        ...valid,
        thumbnailHasFace: false,
        thumbnailEmotion: "none",
      }),
    ).toBe(true)
  })

  it("rejects outputs outside the closed vocabulary or numeric ranges", () => {
    expect(isPackagingTaxonomyOutput(null)).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, titleStyles: ["clickbait"] }),
    ).toBe(false)
    expect(isPackagingTaxonomyOutput({ ...valid, titleStyles: [] })).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, thumbnailEmotion: null }),
    ).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, thumbnailTextWordCount: -1 }),
    ).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, alignmentScore: 1.2 }),
    ).toBe(false)
    expect(isPackagingTaxonomyOutput({ ...valid, topics: [] })).toBe(false)
  })
})
