import { describe, expect, it } from "vitest"

import {
  isTipFeedbackReason,
  normaliseTipSourcePath,
  TIP_FEEDBACK_REASONS,
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FINGERPRINT_MAX_LENGTH,
  TIP_SURFACES,
  TIP_SURFACE_LABELS,
  tipFingerprint,
  tipSurface,
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
    expect(tipSurface("/dashboard/tip-checklist", "Pacing")).toBe("unknown")
    expect(tipSurface(null, null)).toBe("unknown")
  })

  it("labels every surface it can return", () => {
    for (const surface of TIP_SURFACES) {
      expect(TIP_SURFACE_LABELS[surface]).toBeTruthy()
    }
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
