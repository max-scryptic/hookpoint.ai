import { describe, expect, it } from "vitest"

import {
  alignTitleReads,
  clampRecommendedIndex,
  type ModelTitleOutput,
} from "@/lib/video-plans/packaging-plan"
import {
  InvalidTitlesError,
  MAX_TITLES,
  normaliseTitles,
  TITLE_MAX_LENGTH,
} from "@/lib/video-plans/titles"
import { planReadiness } from "@/lib/video-plans/video-plans"

describe("normaliseTitles", () => {
  it("trims and keeps the creator's order", () => {
    expect(normaliseTitles(["  Second thoughts ", "A first idea"])).toEqual([
      "Second thoughts",
      "A first idea",
    ])
  })

  it("drops the blank rows the form starts alternatives as", () => {
    expect(normaliseTitles(["Only one", "", "   "])).toEqual(["Only one"])
  })

  it("collapses duplicates, keeping the first spelling typed", () => {
    expect(normaliseTitles(["My Title", "my title", "Another"])).toEqual([
      "My Title",
      "Another",
    ])
  })

  it(`keeps at most ${MAX_TITLES}`, () => {
    expect(normaliseTitles(["a", "b", "c", "d"])).toEqual(["a", "b", "c"])
  })

  it("ignores entries that are not strings", () => {
    expect(normaliseTitles([null, 7, "Real title", {}])).toEqual([
      "Real title",
    ])
  })

  it("rejects a submission with nothing usable in it", () => {
    expect(() => normaliseTitles(["", "  "])).toThrow(InvalidTitlesError)
    expect(() => normaliseTitles([])).toThrow(InvalidTitlesError)
    expect(() => normaliseTitles("not an array")).toThrow(InvalidTitlesError)
  })

  it("lets a draft hold no titles at all", () => {
    expect(normaliseTitles([], { allowEmpty: true })).toEqual([])
    expect(normaliseTitles(["", "  "], { allowEmpty: true })).toEqual([])
    // "New plan" sends no titles at all, which is the same empty draft.
    expect(normaliseTitles(undefined, { allowEmpty: true })).toEqual([])
    expect(normaliseTitles(null, { allowEmpty: true })).toEqual([])
  })

  it("still rejects something that is not a title list, draft or not", () => {
    expect(() => normaliseTitles("not an array", { allowEmpty: true })).toThrow(
      InvalidTitlesError,
    )
    expect(() =>
      normaliseTitles(["x".repeat(TITLE_MAX_LENGTH + 1)], { allowEmpty: true }),
    ).toThrow(InvalidTitlesError)
  })

  it("rejects a title past YouTube's own limit", () => {
    expect(() => normaliseTitles(["x".repeat(TITLE_MAX_LENGTH + 1)])).toThrow(
      InvalidTitlesError,
    )
    // The limit itself is allowed.
    expect(normaliseTitles(["x".repeat(TITLE_MAX_LENGTH)])).toHaveLength(1)
  })
})

function makeRead(overrides: Partial<ModelTitleOutput> = {}): ModelTitleOutput {
  return {
    title: "whatever the model echoed",
    summary: "Direct promise, low specificity",
    alignmentScore: 7,
    whatWorks: "It names the same outcome the thumbnail shows.",
    whatToChange: "Say which of the three methods it is about.",
    examples: [{ label: "Name the method", example: "The cold-brew method" }],
    ...overrides,
  }
}

describe("alignTitleReads", () => {
  it("takes the wording from what was submitted, not from the model's echo", () => {
    const reads = alignTitleReads(
      ["The title I actually typed"],
      [makeRead({ title: "The Title I Actually Typed!" })],
    )
    expect(reads[0].title).toBe("The title I actually typed")
  })

  it("matches reads to titles by position", () => {
    const reads = alignTitleReads(
      ["first", "second"],
      [makeRead({ alignmentScore: 3 }), makeRead({ alignmentScore: 9 })],
    )
    expect(reads.map((read) => [read.title, read.alignmentScore])).toEqual([
      ["first", 3],
      ["second", 9],
    ])
  })

  it("drops the trailing titles a short response never read", () => {
    const reads = alignTitleReads(["first", "second", "third"], [makeRead()])
    expect(reads).toHaveLength(1)
    expect(reads[0].title).toBe("first")
  })

  it("clamps a score outside the scale it is drawn on", () => {
    expect(
      alignTitleReads(["a"], [makeRead({ alignmentScore: 42 })])[0]
        .alignmentScore,
    ).toBe(10)
    expect(
      alignTitleReads(["a"], [makeRead({ alignmentScore: -3 })])[0]
        .alignmentScore,
    ).toBe(0)
    expect(
      alignTitleReads(["a"], [makeRead({ alignmentScore: Number.NaN })])[0]
        .alignmentScore,
    ).toBe(0)
  })

  it("drops examples for a title with nothing to change", () => {
    const reads = alignTitleReads(["a"], [makeRead({ whatToChange: "  " })])
    expect(reads[0].whatToChange).toBe("")
    expect(reads[0].examples).toEqual([])
  })
})

describe("clampRecommendedIndex", () => {
  it("keeps an index that names a title", () => {
    expect(clampRecommendedIndex(2, 3)).toBe(2)
  })

  it("falls back to the title the creator led with", () => {
    expect(clampRecommendedIndex(5, 3)).toBe(0)
    expect(clampRecommendedIndex(-1, 3)).toBe(0)
    expect(clampRecommendedIndex(1.5, 3)).toBe(0)
  })

  it("survives having no titles at all to point at", () => {
    expect(clampRecommendedIndex(0, 0)).toBe(0)
  })
})

describe("planReadiness", () => {
  const complete = { titles: ["A title"], thumbnailStoragePath: "u/p/t.jpg" }

  it("is ready once all three are in", () => {
    expect(planReadiness(complete, true)).toEqual({ ready: true })
  })

  it("names the missing piece, checking them in the order they are entered", () => {
    expect(
      planReadiness({ titles: [], thumbnailStoragePath: null }, false),
    ).toEqual({ ready: false, reason: "no_titles" })
    expect(
      planReadiness({ ...complete, thumbnailStoragePath: null }, false),
    ).toEqual({ ready: false, reason: "no_thumbnail" })
    expect(planReadiness(complete, false)).toEqual({
      ready: false,
      reason: "no_footage",
    })
  })
})
