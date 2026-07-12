import { describe, expect, it } from "vitest"

import {
  isDeepAnalysisFeedbackRating,
  isDeepAnalysisFeedbackReason,
} from "@/lib/deep-analysis-insight-feedback"

describe("deep analysis insight feedback validation", () => {
  it("accepts only known ratings", () => {
    expect(isDeepAnalysisFeedbackRating("helpful")).toBe(true)
    expect(isDeepAnalysisFeedbackRating("not_helpful")).toBe(true)
    expect(isDeepAnalysisFeedbackRating("maybe")).toBe(false)
  })

  it("accepts only known negative-feedback reasons", () => {
    expect(isDeepAnalysisFeedbackReason("incorrect")).toBe(true)
    expect(isDeepAnalysisFeedbackReason("not_actionable")).toBe(true)
    expect(isDeepAnalysisFeedbackReason("unrecognised")).toBe(false)
  })
})
