import { describe, expect, it } from "vitest"

import {
  buildSparseBaselineRanges,
  computeSparseVideoFeatureBaseline,
} from "@/lib/video-feature-baseline"

describe("buildSparseBaselineRanges", () => {
  it("samples eight seconds around the middle of each minute", () => {
    expect(buildSparseBaselineRanges(130)).toEqual([
      { fromSeconds: 26, toSeconds: 34 },
      { fromSeconds: 86, toSeconds: 94 },
    ])
  })

  it("uses one centered sample for a short video", () => {
    expect(buildSparseBaselineRanges(20)).toEqual([
      { fromSeconds: 6, toSeconds: 14 },
    ])
  })
})

describe("computeSparseVideoFeatureBaseline", () => {
  it("aggregates sampled editing and motion while using the full transcript", () => {
    const baseline = computeSparseVideoFeatureBaseline({
      durationSeconds: 120,
      generatedAt: "2026-07-12T00:00:00.000Z",
      transcript: [
        { startSeconds: 0, endSeconds: 10, text: "one two three four" },
        { startSeconds: 60, endSeconds: 70, text: "five six" },
      ],
      samples: [
        {
          range: { fromSeconds: 26, toSeconds: 34 },
          result: {
            cuts: [{ atSeconds: 30 }],
            freezes: [{ fromSeconds: 26, toSeconds: 28 }],
            blacks: [],
            motionBuckets: [{ fromSeconds: 26, toSeconds: 34, score: 0.2 }],
          },
        },
        {
          range: { fromSeconds: 86, toSeconds: 94 },
          result: {
            cuts: [{ atSeconds: 88 }],
            freezes: [],
            blacks: [{ fromSeconds: 90, toSeconds: 94 }],
            motionBuckets: [{ fromSeconds: 86, toSeconds: 94, score: 0.6 }],
          },
        },
      ],
    })

    expect(baseline).toMatchObject({
      sampledSeconds: 16,
      cutsPerMinute: 7.5,
      freezeCoverage: 0.125,
      blackCoverage: 0.25,
      motion: 0.4,
      speechRate: 3,
    })
  })
})
