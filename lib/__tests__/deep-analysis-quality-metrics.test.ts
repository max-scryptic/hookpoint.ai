import { describe, expect, it } from "vitest"

import { computeDeepAnalysisQualityMetrics } from "@/lib/deep-analysis-quality-metrics"

describe("computeDeepAnalysisQualityMetrics", () => {
  it("calculates usefulness, suppression, coverage and cost metrics", () => {
    const metrics = computeDeepAnalysisQualityMetrics([
      { rating: "helpful", reason: null, evaluated_payload: {
        events: [{ primaryEvidence: "combined" }], recommendations: [{}],
        suppression: [{}, {}], cost: { llmUsd: 0.03 },
      } },
      { rating: "not_helpful", reason: "too_generic", evaluated_payload: {
        events: [{ primaryEvidence: "audio" }], recommendations: [],
        suppression: [], cost: { llmUsd: 0.01 },
      } },
    ])
    expect(metrics).toMatchObject({
      feedbackCount: 2, helpfulRate: 0.5, suppressionRate: 0.5,
      recommendationCoverage: 0.5, costPerHelpfulInsightUsd: 0.04,
      notHelpfulByReason: { too_generic: 1 },
    })
  })
})
