import { describe, expect, it } from "vitest"

import {
  isTipFeedbackReason,
  normaliseTipSourcePath,
  TIP_FEEDBACK_REASONS,
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FINGERPRINT_MAX_LENGTH,
  tipFingerprint,
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
