import { describe, expect, it } from "vitest"

import {
  computeSceneCueMetrics,
  type VideoSceneCue,
} from "@/lib/video-scene-cues"

function cue(overrides: Partial<VideoSceneCue>): VideoSceneCue {
  return {
    id: "cue-1",
    kind: "cut",
    fromSeconds: 0,
    toSeconds: 0,
    score: null,
    ...overrides,
  }
}

describe("computeSceneCueMetrics", () => {
  it("counts only cuts whose timestamp falls inside the range", () => {
    const cues = [
      cue({ kind: "cut", fromSeconds: 5, toSeconds: 5 }),
      cue({ kind: "cut", fromSeconds: 15, toSeconds: 15 }),
      cue({ kind: "cut", fromSeconds: 25, toSeconds: 25 }),
    ]

    const metrics = computeSceneCueMetrics(cues, 10, 20)
    expect(metrics.cutCount).toBe(1)
  })

  it("derives cuts per minute from the range's duration", () => {
    const cues = [
      cue({ kind: "cut", fromSeconds: 5, toSeconds: 5 }),
      cue({ kind: "cut", fromSeconds: 10, toSeconds: 10 }),
      cue({ kind: "cut", fromSeconds: 15, toSeconds: 15 }),
    ]

    // 3 cuts across a 30-second range => 6 cuts/minute.
    expect(computeSceneCueMetrics(cues, 0, 30).cutsPerMinute).toBe(6)
  })

  it("returns null cuts-per-minute for a zero-length range", () => {
    expect(computeSceneCueMetrics([], 10, 10).cutsPerMinute).toBeNull()
  })

  it("clips freeze/black spans that extend past the range when summing coverage", () => {
    const cues = [
      cue({ kind: "freeze", fromSeconds: -5, toSeconds: 5 }),
      cue({ kind: "black", fromSeconds: 8, toSeconds: 100 }),
    ]

    const metrics = computeSceneCueMetrics(cues, 0, 10)
    // freeze overlap: [0,5] = 5s; black overlap: [8,10] = 2s, of a 10s range.
    expect(metrics.freezeCoverage).toBeCloseTo(0.5)
    expect(metrics.blackCoverage).toBeCloseTo(0.2)
  })

  it("ignores cues outside the range entirely", () => {
    const cues = [cue({ kind: "freeze", fromSeconds: 100, toSeconds: 110 })]
    expect(computeSceneCueMetrics(cues, 0, 30).freezeCoverage).toBe(0)
  })

  it("computes a whole-video baseline the same way as any other range", () => {
    const cues = [
      cue({ kind: "cut", fromSeconds: 30, toSeconds: 30 }),
      cue({ kind: "cut", fromSeconds: 90, toSeconds: 90 }),
    ]
    // 2 cuts across a 120s (2 minute) video => 1 cut/minute baseline.
    expect(computeSceneCueMetrics(cues, 0, 120).cutsPerMinute).toBe(1)
  })
})
