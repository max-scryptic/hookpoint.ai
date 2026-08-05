import { describe, expect, it } from "vitest"

import {
  isTipCategory,
  isTipFeedbackReason,
  normaliseTipSourcePath,
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
  TIP_FEEDBACK_REASONS,
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FINGERPRINT_MAX_LENGTH,
  TIP_SURFACES,
  TIP_SURFACE_LABELS,
  tipCategoryCounts,
  tipCategoryForSection,
  tipFingerprint,
  tipSurface,
  type SavedTip,
  type TipCategory,
} from "@/lib/tips"

describe("tipFingerprint", () => {
  it("treats the same advice in different casing and punctuation as one tip", () => {
    expect(tipFingerprint("Cut the intro to one line.")).toBe(
      tipFingerprint("cut the intro to one line"),
    )
    expect(tipFingerprint("Open on the result - no setup")).toBe(
      tipFingerprint("Open on the result, no setup!"),
    )
  })

  it("keeps genuinely different advice apart", () => {
    expect(tipFingerprint("Cut the intro to one line")).not.toBe(
      tipFingerprint("Cut the outro to one line"),
    )
  })

  it("collapses runs of whitespace so wrapping never changes the key", () => {
    expect(tipFingerprint("Lead   with\nthe number")).toBe(
      "lead with the number",
    )
  })

  it("stays inside the column's bound for a very long tip", () => {
    const fingerprint = tipFingerprint("word ".repeat(500))
    expect(fingerprint.length).toBeLessThanOrEqual(TIP_FINGERPRINT_MAX_LENGTH)
  })

  it("returns nothing for a tip with no words in it", () => {
    expect(tipFingerprint("   ...   ")).toBe("")
  })
})

describe("normaliseTipSourcePath", () => {
  it("keeps an in-app path", () => {
    expect(normaliseTipSourcePath("/dashboard/analysed-video/abc")).toBe(
      "/dashboard/analysed-video/abc",
    )
    expect(
      normaliseTipSourcePath("/dashboard/video-comparator/report?id=1"),
    ).toBe("/dashboard/video-comparator/report?id=1")
  })

  it("drops anything that could point off the site", () => {
    expect(normaliseTipSourcePath("https://example.com/phish")).toBeNull()
    expect(normaliseTipSourcePath("//example.com/phish")).toBeNull()
    expect(normaliseTipSourcePath("dashboard/relative")).toBeNull()
  })

  it("drops empty, over-long and non-string values", () => {
    expect(normaliseTipSourcePath("   ")).toBeNull()
    expect(normaliseTipSourcePath(`/${"a".repeat(600)}`)).toBeNull()
    expect(normaliseTipSourcePath(undefined)).toBeNull()
    expect(normaliseTipSourcePath(42)).toBeNull()
  })
})

describe("tipSurface", () => {
  it("reads the surface off the path the tip was flagged on", () => {
    expect(tipSurface("/dashboard/analysed-video/Rk9YJK1sKek", "Packaging: Title")).toBe(
      "video_analysis",
    )
    expect(
      tipSurface(
        "/dashboard/video-comparator/report?a=1&b=2",
        "Packaging head-to-head: Title",
      ),
    ).toBe("comparison_report")
  })

  it("does not read the analysed video list as a report", () => {
    expect(tipSurface("/dashboard/analysed-videos", "Packaging: Title")).toBe(
      "unknown",
    )
  })

  it("falls back to the section when there is no usable path", () => {
    expect(tipSurface(null, "Retention head-to-head: Hook")).toBe(
      "comparison_report",
    )
    expect(tipSurface(undefined, "Script head-to-head: Opening")).toBe(
      "comparison_report",
    )
  })

  it("says unknown rather than guessing at a pathless section", () => {
    expect(tipSurface(null, "Packaging: Title")).toBe("unknown")
    expect(tipSurface("/dashboard/checklist", "Pacing")).toBe("unknown")
    expect(tipSurface(null, null)).toBe("unknown")
  })

  it("labels every surface it can return", () => {
    for (const surface of TIP_SURFACES) {
      expect(TIP_SURFACE_LABELS[surface]).toBeTruthy()
    }
  })
})

describe("tipCategoryForSection", () => {
  // Every section string the interface actually passes to a "Try:" callout,
  // with the group it must land in on the checklist. If a call site starts
  // naming its section differently, add it here.
  it.each([
    ["Retention: Hook", "hook"],
    ["Retention: Drop-off", "retention"],
    ["Retention: Gain", "attention"],
    ["Retention: Hold", "attention"],
    ["Pacing", "attention"],
    ["Packaging: Title", "packaging"],
    ["Packaging: Thumbnail", "packaging"],
    ["Packaging head-to-head: Thumbnail", "packaging"],
    ["Retention head-to-head: Hook and opening", "hook"],
    ["Retention head-to-head: Emotion and energy", "retention"],
    ["Script head-to-head: Structure", "script"],
    ["Deep analysis: Non-verbal takeaway", "delivery"],
  ])("files %s under %s", (section, category) => {
    expect(tipCategoryForSection(section)).toBe(category)
  })

  it("files a tip by the tab it sits on before the moment it came from", () => {
    // A script rewrite for a drop-off is script work, and a note about what the
    // video looked like there is delivery work, whatever the moment was.
    expect(tipCategoryForSection("Retention: Drop-off: Script")).toBe("script")
    expect(tipCategoryForSection("Retention: Hook: Script")).toBe("script")
    expect(tipCategoryForSection("Retention: Drop-off: Deep analysis")).toBe(
      "delivery",
    )
  })

  it("keeps losing viewers apart from holding them", () => {
    expect(tipCategoryForSection("Retention: Drop-off")).not.toBe(
      tipCategoryForSection("Retention: Hold"),
    )
  })

  it("ignores casing", () => {
    expect(tipCategoryForSection("RETENTION: HOOK")).toBe("hook")
  })

  it("leaves a section it does not recognise uncategorised", () => {
    expect(tipCategoryForSection("Channel trends: Uploads per week")).toBe(
      "other",
    )
    expect(tipCategoryForSection("")).toBe("other")
  })

  it("only ever returns a category the interface can label", () => {
    for (const category of TIP_CATEGORIES) {
      expect(isTipCategory(category)).toBe(true)
      expect(TIP_CATEGORY_LABELS[category]).toBeTruthy()
    }
    expect(isTipCategory("titles")).toBe(false)
    expect(isTipCategory(null)).toBe(false)
  })
})

describe("tipCategoryCounts", () => {
  const tip = (id: string, category: TipCategory): SavedTip => ({
    id,
    tip: `Tip ${id}`,
    section: "Retention: Hook",
    category,
    sourcePath: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  })

  it("counts each category the checklist actually has tips under", () => {
    expect(
      tipCategoryCounts([
        tip("1", "packaging"),
        tip("2", "hook"),
        tip("3", "hook"),
      ]),
    ).toEqual([
      { category: "hook", count: 2 },
      { category: "packaging", count: 1 },
    ])
  })

  it("leaves out a category with nothing kept under it", () => {
    const counted = tipCategoryCounts([tip("1", "hook")])
    expect(counted).toEqual([{ category: "hook", count: 1 }])
    expect(counted.every(({ count }) => count > 0)).toBe(true)
  })

  // The filter is built off this, so the order has to be the fixed one a
  // creator sees every time, not the order their own list happens to fall in.
  it("lists the categories in the order a video is planned in", () => {
    const counted = tipCategoryCounts([
      tip("1", "other"),
      tip("2", "packaging"),
      tip("3", "hook"),
    ])
    expect(counted.map(({ category }) => category)).toEqual([
      "hook",
      "packaging",
      "other",
    ])
  })

  it("has nothing to offer for an empty checklist", () => {
    expect(tipCategoryCounts([])).toEqual([])
  })
})

describe("isTipFeedbackReason", () => {
  it("accepts every reason the interface offers", () => {
    for (const reason of TIP_FEEDBACK_REASONS) {
      expect(isTipFeedbackReason(reason)).toBe(true)
      expect(TIP_FEEDBACK_REASON_LABELS[reason]).toBeTruthy()
    }
  })

  it("rejects anything else", () => {
    expect(isTipFeedbackReason("helpful")).toBe(false)
    expect(isTipFeedbackReason(null)).toBe(false)
    expect(isTipFeedbackReason(undefined)).toBe(false)
  })
})
