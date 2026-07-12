import { afterEach, describe, expect, it } from "vitest"

import {
  getDeepAnalysisMinimumInsightScore,
  getDeepAnalysisRollout,
} from "@/lib/deep-analysis-config"

afterEach(() => {
  delete process.env.DEEP_ANALYSIS_MIN_INSIGHT_SCORE
  delete process.env.DEEP_ANALYSIS_ROLLOUT_PERCENT
  delete process.env.DEEP_ANALYSIS_RECOMMENDATIONS_ENABLED
})

describe("deep analysis configuration", () => {
  it("clamps calibration thresholds", () => {
    process.env.DEEP_ANALYSIS_MIN_INSIGHT_SCORE = "2"
    expect(getDeepAnalysisMinimumInsightScore()).toBe(1)
  })

  it("supports a deterministic rollout kill switch", () => {
    process.env.DEEP_ANALYSIS_ROLLOUT_PERCENT = "0"
    expect(getDeepAnalysisRollout("user-1")).toEqual({
      insights: false,
      recommendations: false,
      evidencePanel: false,
    })
  })

  it("can independently disable recommendations", () => {
    process.env.DEEP_ANALYSIS_RECOMMENDATIONS_ENABLED = "false"
    expect(getDeepAnalysisRollout("user-1")).toMatchObject({
      insights: true,
      recommendations: false,
    })
  })
})
