import { describe, expect, it } from "vitest"

import {
  analysedVideoIdFromPath,
  canGenerateTipExamples,
  normaliseTipExamples,
  tipExamplesContextKey,
  TIP_EXAMPLES_COUNT,
  TIP_EXAMPLES_TIP_MAX_LENGTH,
  TIP_EXAMPLE_LABEL_MAX_LENGTH,
  TIP_EXAMPLE_MAX_LENGTH,
} from "@/lib/tip-examples"

describe("normaliseTipExamples", () => {
  it("keeps well-formed examples as they are", () => {
    expect(
      normaliseTipExamples([
        { label: "Straight to the number", example: '"This deck won me eleven games in a row."' },
      ]),
    ).toEqual([
      {
        label: "Straight to the number",
        example: '"This deck won me eleven games in a row."',
      },
    ])
  })

  it("collapses the whitespace a model writes into an example", () => {
    expect(
      normaliseTipExamples([
        { label: " Open on\nthe obstacle ", example: "Cut in on\n  the play  already happening." },
      ]),
    ).toEqual([
      {
        label: "Open on the obstacle",
        example: "Cut in on the play already happening.",
      },
    ])
  })

  it("scrubs the em dashes a model writes, like every other rendered copy", () => {
    expect(
      normaliseTipExamples([
        { label: "Open on the number", example: '"Eleven wins — no losses."' },
      ]),
    ).toEqual([
      { label: "Open on the number", example: '"Eleven wins - no losses."' },
    ])
  })

  it("leaves the wording of an example alone, including a spoken 'Try'", () => {
    // cleanCopy would strip this opener, because a tip is printed under a
    // "Try:" label. An example is the line itself, so it keeps its words.
    expect(
      normaliseTipExamples([
        { label: "Invite them in", example: '"Try this yourself before you watch on."' },
      ]),
    ).toEqual([
      {
        label: "Invite them in",
        example: '"Try this yourself before you watch on."',
      },
    ])
  })

  it("drops an entry with no example text rather than rendering an empty tab", () => {
    expect(
      normaliseTipExamples([
        { label: "One", example: "   " },
        { label: "Two", example: "Say the result before the setup." },
        { label: "Three" },
        null,
        "not an example",
      ]),
    ).toEqual([{ label: "Two", example: "Say the result before the setup." }])
  })

  it("names an unlabelled example by its position, so its tab can still be opened", () => {
    expect(
      normaliseTipExamples([
        { label: "", example: "Open on the claim." },
        { example: "Open on the obstacle." },
      ]),
    ).toEqual([
      { label: "Example 1", example: "Open on the claim." },
      { label: "Example 2", example: "Open on the obstacle." },
    ])
  })

  it("keeps no more examples than the tab strip is built for", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      label: `Label ${index}`,
      example: `Example ${index}`,
    }))
    expect(normaliseTipExamples(many)).toHaveLength(TIP_EXAMPLES_COUNT)
  })

  it("cuts an over-long example and label at a word boundary", () => {
    const [normalised] = normaliseTipExamples([
      {
        label: "an unreasonably long label ".repeat(5),
        example: "word ".repeat(200),
      },
    ])
    expect(normalised.label.length).toBeLessThanOrEqual(
      TIP_EXAMPLE_LABEL_MAX_LENGTH,
    )
    expect(normalised.example.length).toBeLessThanOrEqual(
      TIP_EXAMPLE_MAX_LENGTH,
    )
    expect(normalised.label).not.toMatch(/\s$/)
    expect(normalised.example).not.toMatch(/\s$/)
  })

  it("returns nothing for anything that is not a list of examples", () => {
    expect(normaliseTipExamples(undefined)).toEqual([])
    expect(normaliseTipExamples(null)).toEqual([])
    expect(normaliseTipExamples({ examples: [] })).toEqual([])
    expect(normaliseTipExamples("Open on the claim")).toEqual([])
  })
})

describe("canGenerateTipExamples", () => {
  it("writes examples for a tip that is one line of advice", () => {
    expect(
      canGenerateTipExamples("Open on the specific claim rather than the setup"),
    ).toBe(true)
  })

  it("refuses an empty tip and a report section that leaked into a callout", () => {
    expect(canGenerateTipExamples("   ")).toBe(false)
    expect(
      canGenerateTipExamples("a".repeat(TIP_EXAMPLES_TIP_MAX_LENGTH + 1)),
    ).toBe(false)
  })
})

describe("analysedVideoIdFromPath", () => {
  it("reads the video the tip was read on", () => {
    expect(analysedVideoIdFromPath("/analysed-video/Rk9YJK1sKek")).toBe(
      "Rk9YJK1sKek",
    )
    expect(analysedVideoIdFromPath("/analysed-video/Rk9YJK1sKek/")).toBe(
      "Rk9YJK1sKek",
    )
    // The path this screen used to live at, still posted by an open tab.
    expect(
      analysedVideoIdFromPath("/dashboard/analysed-video/Rk9YJK1sKek?tab=hook"),
    ).toBe("Rk9YJK1sKek")
  })

  it("has no single video for a head-to-head or an unknown page", () => {
    expect(
      analysedVideoIdFromPath("/video-comparator/report?comparison=1"),
    ).toBeNull()
    expect(analysedVideoIdFromPath("/checklist")).toBeNull()
    expect(analysedVideoIdFromPath(null)).toBeNull()
    expect(analysedVideoIdFromPath(undefined)).toBeNull()
  })

  it("does not read an id out of a path that only starts the same way", () => {
    expect(analysedVideoIdFromPath("/analysed-videos")).toBeNull()
    expect(
      analysedVideoIdFromPath("/analysed-video/Rk9YJK1sKek/deep/analysis"),
    ).toBeNull()
    expect(analysedVideoIdFromPath("https://example.com/analysed-video/x")).toBeNull()
  })
})

describe("tipExamplesContextKey", () => {
  it("keys a video's examples by the video, and everything else by one empty key", () => {
    expect(tipExamplesContextKey("Rk9YJK1sKek")).toBe("Rk9YJK1sKek")
    expect(tipExamplesContextKey(null)).toBe("")
    expect(tipExamplesContextKey(undefined)).toBe("")
  })
})
