import { describe, expect, it } from "vitest"

import {
  buildComparisonVideo,
  calibrationFactor,
  computeEvidenceCalibration,
  defaultComparisonPair,
  eventWeight,
  findLargestDivergence,
  watchRatioAt,
  type ComparisonVideoSummary,
} from "@/lib/retention-comparison"
import type { RetentionPoint } from "@/lib/youtube/youtube"

function point(elapsedRatio: number, watchRatio: number): RetentionPoint {
  return {
    elapsedRatio,
    watchRatio,
    relativePerformance: null,
    timestampSeconds: elapsedRatio * 100,
  }
}

function summary(
  overrides: Partial<ComparisonVideoSummary> = {},
): ComparisonVideoSummary {
  return {
    id: "video-a",
    title: "Video A",
    thumbnailUrl: null,
    publishedAt: null,
    durationSeconds: 100,
    views: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    netSubscribersGained: null,
    ...overrides,
  }
}

describe("computeEvidenceCalibration", () => {
  it("returns no rates and zero count with no feedback", () => {
    const calibration = computeEvidenceCalibration([])
    expect(calibration.feedbackCount).toBe(0)
    expect(calibration.rates).toEqual({})
  })

  it("smooths rates so one rating never pins a source to 0 or 1", () => {
    const calibration = computeEvidenceCalibration([
      { rating: "helpful", primaryEvidence: "visual" },
      { rating: "not_helpful", primaryEvidence: "audio" },
    ])
    // One helpful of one: (1 + 1) / (1 + 2).
    expect(calibration.rates.visual).toBeCloseTo(2 / 3)
    // Zero helpful of one: (0 + 1) / (1 + 2).
    expect(calibration.rates.audio).toBeCloseTo(1 / 3)
  })

  it("orders repeatedly-unhelpful evidence below repeatedly-helpful", () => {
    const calibration = computeEvidenceCalibration([
      ...Array.from({ length: 8 }, () => ({
        rating: "helpful" as const,
        primaryEvidence: "transcript" as const,
      })),
      ...Array.from({ length: 8 }, () => ({
        rating: "not_helpful" as const,
        primaryEvidence: "editing" as const,
      })),
    ])
    expect(calibration.rates.transcript!).toBeGreaterThan(
      calibration.rates.editing!,
    )
  })
})

describe("calibrationFactor / eventWeight", () => {
  it("is neutral for unobserved evidence and null evidence", () => {
    const calibration = computeEvidenceCalibration([])
    expect(calibrationFactor(calibration, "visual")).toBe(1)
    expect(calibrationFactor(calibration, null)).toBe(1)
  })

  it("scales confidence by the evidence's smoothed helpful rate", () => {
    const calibration = computeEvidenceCalibration([
      { rating: "not_helpful", primaryEvidence: "audio" },
      { rating: "not_helpful", primaryEvidence: "audio" },
    ])
    const downWeighted = eventWeight(calibration, {
      confidence: 0.9,
      primaryEvidence: "audio",
    })
    const neutral = eventWeight(calibration, {
      confidence: 0.9,
      primaryEvidence: "visual",
    })
    expect(downWeighted).toBeLessThan(neutral)
  })

  it("falls back to a mid confidence for unranked events", () => {
    const calibration = computeEvidenceCalibration([])
    expect(
      eventWeight(calibration, { confidence: null, primaryEvidence: null }),
    ).toBeCloseTo(0.6)
  })
})

describe("watchRatioAt", () => {
  const curve = [point(0.2, 0.8), point(0.6, 0.4), point(1, 0.3)]

  it("returns null for an empty curve", () => {
    expect(watchRatioAt([], 0.5)).toBeNull()
  })

  it("starts from the synthetic 100% baseline before the first sample", () => {
    // Halfway between the 0:00 baseline (1.0) and the 0.2 sample (0.8).
    expect(watchRatioAt(curve, 0.1)).toBeCloseTo(0.9)
  })

  it("interpolates between samples", () => {
    expect(watchRatioAt(curve, 0.4)).toBeCloseTo(0.6)
  })

  it("clamps past the last sample", () => {
    expect(watchRatioAt(curve, 1.5)).toBeCloseTo(0.3)
  })
})

describe("findLargestDivergence", () => {
  it("returns null when either curve is empty", () => {
    expect(findLargestDivergence([], [point(1, 0.5)])).toBeNull()
  })

  it("returns null for identical curves", () => {
    const curve = [point(0.5, 0.6), point(1, 0.4)]
    expect(findLargestDivergence(curve, curve)).toBeNull()
  })

  it("finds the stretch where one curve loses the most ground", () => {
    // A declines gently; B collapses between 40% and 60% of the runtime.
    const curveA = [point(0.2, 0.9), point(0.8, 0.7), point(1, 0.65)]
    const curveB = [
      point(0.2, 0.9),
      point(0.4, 0.85),
      point(0.6, 0.3),
      point(1, 0.25),
    ]
    const divergence = findLargestDivergence(curveA, curveB)
    expect(divergence).not.toBeNull()
    expect(divergence!.widenedFor).toBe("a")
    expect(divergence!.fromRatio).toBeGreaterThanOrEqual(0.2)
    expect(divergence!.toRatio).toBeLessThanOrEqual(0.8)
    expect(divergence!.gapChange).toBeGreaterThan(0.3)
  })

  it("detects divergence in the other direction", () => {
    const curveA = [point(0.4, 0.9), point(0.6, 0.3), point(1, 0.25)]
    const curveB = [point(0.4, 0.9), point(1, 0.7)]
    const divergence = findLargestDivergence(curveA, curveB)
    expect(divergence!.widenedFor).toBe("b")
  })
})

describe("buildComparisonVideo", () => {
  const curve = [point(0.3, 0.7), point(1, 0.4)]
  const windows = [
    {
      id: "w-drop",
      kind: "drop_off" as const,
      fromSeconds: 40,
      toSeconds: 60,
      delta: -0.2,
      relativePerformance: 0.4,
    },
    {
      id: "w-hook",
      kind: "hook" as const,
      fromSeconds: 0,
      toSeconds: 30,
      delta: -0.3,
      relativePerformance: null,
    },
  ]

  it("orders windows chronologically and finds the hook", () => {
    const video = buildComparisonVideo({
      summary: summary(),
      curve,
      windows,
      events: [],
      readySynthesisWindowIds: new Set(),
      calibration: computeEvidenceCalibration([]),
    })
    expect(video.windows.map((window) => window.id)).toEqual([
      "w-hook",
      "w-drop",
    ])
    expect(video.hook?.id).toBe("w-hook")
  })

  it("computes the hook hold ratio at the end of the hook window", () => {
    const video = buildComparisonVideo({
      summary: summary({ durationSeconds: 100 }),
      curve,
      windows,
      events: [],
      readySynthesisWindowIds: new Set(),
      calibration: computeEvidenceCalibration([]),
    })
    // The hook ends at 30s of 100s: the 0.3 sample, watch ratio 0.7.
    expect(video.hookHoldRatio).toBeCloseTo(0.7)
  })

  it("marks deep coverage from the ready synthesis set", () => {
    const video = buildComparisonVideo({
      summary: summary(),
      curve,
      windows,
      events: [],
      readySynthesisWindowIds: new Set(["w-hook"]),
      calibration: computeEvidenceCalibration([]),
    })
    expect(video.hook?.deeplyAnalysed).toBe(true)
    expect(
      video.windows.find((window) => window.id === "w-drop")?.deeplyAnalysed,
    ).toBe(false)
    expect(video.deeplyAnalysedWindowCount).toBe(1)
  })

  it("attaches events to their window, calibrated and capped", () => {
    const calibration = computeEvidenceCalibration([
      ...Array.from({ length: 6 }, () => ({
        rating: "not_helpful" as const,
        primaryEvidence: "audio" as const,
      })),
    ])
    const video = buildComparisonVideo({
      summary: summary(),
      curve,
      windows,
      events: [
        {
          retentionWindowId: "w-drop",
          eventType: "audio_change",
          timestampSeconds: 45,
          narrative: "high confidence but distrusted evidence",
          primaryEvidence: "audio",
          confidence: 0.9,
        },
        {
          retentionWindowId: "w-drop",
          eventType: "pacing_change",
          timestampSeconds: 50,
          narrative: "lower confidence, neutral evidence",
          primaryEvidence: "transcript",
          confidence: 0.75,
        },
      ],
      readySynthesisWindowIds: new Set(["w-drop"]),
      calibration,
    })
    const drop = video.windows.find((window) => window.id === "w-drop")!
    // 0.75 x 1.0 beats 0.9 x (0.5 + smoothed-low rate).
    expect(drop.events[0].eventType).toBe("pacing_change")
    expect(drop.events).toHaveLength(2)
    expect(video.hook?.events).toHaveLength(0)
  })
})

describe("defaultComparisonPair", () => {
  const video = (
    id: string,
    averageViewPercentage: number | null,
  ) => ({ id, title: id, dateAnalysed: null, averageViewPercentage })

  it("returns null below two videos", () => {
    expect(defaultComparisonPair([])).toBeNull()
    expect(defaultComparisonPair([video("only", 50)])).toBeNull()
  })

  it("pairs the strongest and weakest average-watched videos", () => {
    const pair = defaultComparisonPair([
      video("mid", 40),
      video("best", 70),
      video("worst", 20),
    ])
    expect(pair).toEqual({ a: "best", b: "worst" })
  })

  it("falls back to the two most recent when analytics are missing", () => {
    const pair = defaultComparisonPair([
      video("newest", null),
      video("older", null),
      video("oldest", 30),
    ])
    expect(pair).toEqual({ a: "newest", b: "older" })
  })
})
