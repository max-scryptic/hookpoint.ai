import { describe, expect, it } from "vitest"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildComparisonVideo,
  buildRetentionComparison,
  calibrationFactor,
  computeEvidenceCalibration,
  defaultComparisonPair,
  eventWeight,
  findLargestDivergence,
  listComparableVideos,
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
    videoId: "yt-video-a",
    title: "Video A",
    thumbnailUrl: null,
    publishedAt: null,
    durationSeconds: 100,
    views: null,
    analyticsViews: null,
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

  // The whole point of passing view counts: a gap that only exists because one
  // curve was estimated from a handful of people is not a divergence.
  describe("with the audiences behind each curve", () => {
    // An 8 point gap opens between 20% and 60%: comfortably over the fixed
    // practical floor, and nowhere near the noise floor at 60 viewers.
    const curveA = [point(0.2, 0.6), point(0.6, 0.55), point(1, 0.4)]
    const curveB = [point(0.2, 0.6), point(0.6, 0.47), point(1, 0.3)]

    it("reports the gap when both audiences are large enough to measure it", () => {
      const divergence = findLargestDivergence(curveA, curveB, {
        a: 20_000,
        b: 18_000,
      })
      expect(divergence).not.toBeNull()
      expect(divergence!.widenedFor).toBe("a")
      expect(divergence!.gapChangeMargin).toBeLessThan(divergence!.gapChange)
    })

    it("withholds the same gap when one curve came from 60 viewers", () => {
      expect(
        findLargestDivergence(curveA, curveB, { a: 20_000, b: 60 }),
      ).toBeNull()
    })

    it("keeps a divergence wide enough to clear even a small audience", () => {
      // A sheds 51 points across the stretch where B sheds 18: the screenshot
      // pair, whose shape difference is real despite B's 80 viewers.
      const steep = [point(0.05, 0.55), point(0.88, 0.04), point(1, 0.043)]
      const shallow = [point(0.05, 0.27), point(0.88, 0.09), point(1, 0.088)]
      const divergence = findLargestDivergence(steep, shallow, {
        a: 2_000,
        b: 80,
      })
      expect(divergence).not.toBeNull()
      expect(divergence!.widenedFor).toBe("b")
    })

    it("falls back to the fixed floor when a view count is missing", () => {
      const divergence = findLargestDivergence(curveA, curveB, {
        a: 20_000,
        b: null,
      })
      expect(divergence).not.toBeNull()
      expect(divergence!.gapChangeMargin).toBeNull()
    })

    it("still applies the practical floor to enormous audiences", () => {
      // At a million views a 2 point gap is statistically certain and
      // practically meaningless, so it is not worth a creator's attention.
      const flatA = [point(0.5, 0.6), point(1, 0.4)]
      const flatB = [point(0.5, 0.6), point(1, 0.38)]
      expect(
        findLargestDivergence(flatA, flatB, { a: 1_000_000, b: 1_000_000 }),
      ).toBeNull()
    })
  })
})

describe("buildRetentionComparison", () => {
  const build = (
    curveA: RetentionPoint[],
    curveB: RetentionPoint[],
    viewsA: number | null,
    viewsB: number | null,
  ) =>
    buildRetentionComparison(
      buildComparisonVideo({
        summary: summary({ id: "a", analyticsViews: viewsA }),
        curve: curveA,
        windows: [],
        events: [],
        readySynthesisWindowIds: new Set(),
        calibration: computeEvidenceCalibration([]),
      }),
      buildComparisonVideo({
        summary: summary({ id: "b", analyticsViews: viewsB }),
        curve: curveB,
        windows: [],
        events: [],
        readySynthesisWindowIds: new Set(),
        calibration: computeEvidenceCalibration([]),
      }),
      computeEvidenceCalibration([]),
    )

  it("binds a lopsided pair to shape only", () => {
    const data = build(
      [point(0.5, 0.2), point(1, 0.043)],
      [point(0.5, 0.15), point(1, 0.088)],
      2_000,
      80,
    )
    expect(data.reliability.comparable).toBe("shape_only")
    expect(data.reliability.sampleSizeA).toBe(2_000)
    expect(data.reliability.sampleSizeB).toBe(80)
    expect(data.reliability.endingGapIsSignificant).toBe(false)
  })

  it("leaves a well-matched pair comparable on level and shape", () => {
    const data = build(
      [point(0.5, 0.6), point(1, 0.4)],
      [point(0.5, 0.4), point(1, 0.15)],
      9_000,
      7_000,
    )
    expect(data.reliability.comparable).toBe("level_and_shape")
    expect(data.reliability.caveats).toEqual([])
  })

  it("uses the analytics audience over the public counter", () => {
    // The retention curve is reported over the same lifetime window as the
    // analytics views, so that is the sound denominator even when the public
    // counter has run ahead of it.
    const video = (analyticsViews: number | null, views: number | null) =>
      buildComparisonVideo({
        summary: summary({ analyticsViews, views }),
        curve: [point(1, 0.3)],
        windows: [],
        events: [],
        readySynthesisWindowIds: new Set(),
        calibration: computeEvidenceCalibration([]),
      })
    const data = buildRetentionComparison(
      video(1_800, 2_000),
      video(75, 80),
      computeEvidenceCalibration([]),
    )
    expect(data.reliability.sampleSizeA).toBe(1_800)
    expect(data.reliability.sampleSizeB).toBe(75)
  })

  it("falls back to the public counter when analytics have not landed", () => {
    const video = (views: number | null, ending: number) =>
      buildComparisonVideo({
        summary: summary({ analyticsViews: null, views }),
        curve: [point(0.5, ending + 0.2), point(1, ending)],
        windows: [],
        events: [],
        readySynthesisWindowIds: new Set(),
        calibration: computeEvidenceCalibration([]),
      })
    const data = buildRetentionComparison(
      video(9_000, 0.4),
      video(7_000, 0.15),
      computeEvidenceCalibration([]),
    )
    expect(data.reliability.sampleSizeA).toBe(9_000)
    expect(data.reliability.comparable).toBe("level_and_shape")
  })

  it("reports unknown when neither audience is stored at all", () => {
    const data = build([point(1, 0.3)], [point(1, 0.3)], null, null)
    expect(data.reliability.comparable).toBe("unknown")
    expect(data.divergence).toBeNull()
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
  ) => ({
    id,
    title: id,
    dateAnalysed: null,
    averageViewPercentage,
    views: 10_000,
  })

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

// A tiny thenable PostgREST stub: it applies the eq/in filters the loader uses
// so the test exercises the real deeply-analysed gating, not a hand-fed answer.
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>): {
  supabase: SupabaseClient
  synthesisSelects: string[]
} {
  const synthesisSelects: string[] = []
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const builder: Record<string, unknown> = {
      select(columns: string) {
        if (table === "retention_window_event_synthesis") {
          synthesisSelects.push(columns)
        }
        return builder
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value)
        return builder
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]))
        return builder
      },
      not() {
        return builder
      },
      order() {
        return builder
      },
      limit() {
        return Promise.resolve({ data: rows, error: null })
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return {
    supabase: { from } as unknown as SupabaseClient,
    synthesisSelects,
  }
}

describe("listComparableVideos", () => {
  it("returns only videos whose deep analysis has completed", async () => {
    const { supabase } = fakeSupabase({
      retention_window_event_synthesis: [
        { user_id: "u1", analysed_video_id: "deep-a", status: "ready" },
        { user_id: "u1", analysed_video_id: "deep-b", status: "ready" },
        // A second ready window for the same video must not duplicate it.
        { user_id: "u1", analysed_video_id: "deep-a", status: "ready" },
        // Not deeply analysed yet: still synthesizing.
        { user_id: "u1", analysed_video_id: "pending-c", status: "pending" },
        // Another user's rows must never leak in.
        { user_id: "u2", analysed_video_id: "other-d", status: "ready" },
      ],
      analysed_videos: [
        {
          user_id: "u1",
          id: "deep-a",
          video_title: "Deep A",
          date_analysed: "2026-01-02",
          average_view_percentage: 40,
        },
        {
          user_id: "u1",
          id: "deep-b",
          video_title: "Deep B",
          date_analysed: "2026-01-01",
          average_view_percentage: 60,
        },
        {
          user_id: "u1",
          id: "pending-c",
          video_title: "Pending C",
          date_analysed: "2026-01-03",
          average_view_percentage: 55,
        },
      ],
    })

    const videos = await listComparableVideos(supabase, "u1")

    expect(videos.map((video) => video.id).sort()).toEqual(["deep-a", "deep-b"])
    expect(videos.every((video) => video.id !== "pending-c")).toBe(true)
  })

  it("returns an empty list without querying videos when none are deeply analysed", async () => {
    const { supabase } = fakeSupabase({
      retention_window_event_synthesis: [
        { user_id: "u1", analysed_video_id: "only-c", status: "pending" },
      ],
      analysed_videos: [
        {
          user_id: "u1",
          id: "only-c",
          video_title: "Only C",
          date_analysed: "2026-01-01",
          average_view_percentage: 50,
        },
      ],
    })

    const videos = await listComparableVideos(supabase, "u1")

    expect(videos).toEqual([])
  })
})
