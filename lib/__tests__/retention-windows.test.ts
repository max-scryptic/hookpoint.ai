import { describe, expect, it } from "vitest"

import {
  buildRetentionWindows,
  computeAnalysisWindow,
} from "@/lib/retention-windows"
import type { RetentionPoint } from "@/lib/youtube/youtube"

function point(
  timestampSeconds: number,
  watchRatio: number,
  relativePerformance: number | null = 0.6,
): RetentionPoint {
  return {
    elapsedRatio: timestampSeconds / 60,
    watchRatio,
    relativePerformance,
    timestampSeconds,
  }
}

describe("buildRetentionWindows", () => {
  // A curve with a losing hook, one underperforming mid-video drop, and a
  // late rebound (gain).
  const retention = [
    point(0, 1),
    point(10, 0.8),
    point(30, 0.6),
    point(40, 0.58),
    point(50, 0.4, 0.3),
    point(60, 0.5),
  ]

  it("emits the two fixed hook windows as losses", () => {
    const hooks = buildRetentionWindows(retention, 60).filter(
      (w) => w.kind === "hook",
    )

    expect(hooks).toHaveLength(2)
    expect(hooks[0]).toMatchObject({
      windowIndex: 0,
      windowKey: "initial-hook",
      startWatchRatio: 1,
      endWatchRatio: 0.8,
      outOfRange: false,
    })
    // Hook delivery inherits the previous window's ending retention.
    expect(hooks[1].windowKey).toBe("hook-delivery")
    // Losses are stored as a negative delta.
    expect(hooks[0].delta).toBeCloseTo(-0.2)
    expect(hooks[1].delta).toBeCloseTo(-0.2)
  })

  it("stores a significant mid-video drop-off with a negative delta", () => {
    const drops = buildRetentionWindows(retention, 60).filter(
      (w) => w.kind === "drop_off",
    )

    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({
      fromSeconds: 40,
      toSeconds: 50,
      relativePerformance: 0.3,
      isAbnormallySteep: false,
    })
    expect(drops[0].delta).toBeCloseTo(-0.18)
    expect(drops[0].steepness).not.toBeNull()
  })

  it("stores a retention gain with a positive delta", () => {
    const gains = buildRetentionWindows(retention, 60).filter(
      (w) => w.kind === "gain",
    )

    expect(gains).toHaveLength(1)
    expect(gains[0]).toMatchObject({
      kind: "gain",
      fromSeconds: 50,
      toSeconds: 60,
      windowKey: null,
      relativePerformance: null,
    })
    expect(gains[0].delta).toBeCloseTo(0.1)
  })

  it("indexes each kind from zero independently", () => {
    const windows = buildRetentionWindows(retention, 60)
    for (const kind of ["hook", "drop_off", "gain"] as const) {
      const ofKind = windows.filter((w) => w.kind === kind)
      expect(ofKind.map((w) => w.windowIndex)).toEqual(
        ofKind.map((_, index) => index),
      )
    }
  })

  it("carries the combined 0-30s analysis window on the first hook row only", () => {
    const hooks = buildRetentionWindows(retention, 60).filter(
      (w) => w.kind === "hook",
    )
    expect(hooks[0]).toMatchObject({
      analysisFromSeconds: 0,
      analysisToSeconds: 30,
    })
    expect(hooks[1].analysisFromSeconds).toBeNull()
    expect(hooks[1].analysisToSeconds).toBeNull()
  })

  it("pads the drop-off and gain analysis windows around their midpoint", () => {
    const windows = buildRetentionWindows(retention, 60)
    const drop = windows.find((w) => w.kind === "drop_off")!
    const gain = windows.find((w) => w.kind === "gain")!

    // drop-off step is 40 -> 50, midpoint 45; padded -30/+10.
    expect(drop.analysisFromSeconds).toBeCloseTo(15)
    expect(drop.analysisToSeconds).toBeCloseTo(55)

    // gain step is 50 -> 60, midpoint 55; padded -10/+20, clamped to duration.
    expect(gain.analysisFromSeconds).toBeCloseTo(45)
    expect(gain.analysisToSeconds).toBeCloseTo(60)
  })
})

describe("computeAnalysisWindow", () => {
  it("returns the combined hook window only for window_index 0", () => {
    expect(computeAnalysisWindow("hook", 0, 0, 10, 120)).toEqual({
      fromSeconds: 0,
      toSeconds: 30,
    })
    expect(computeAnalysisWindow("hook", 1, 10, 30, 120)).toBeNull()
  })

  it("clamps the hook window to a short video's duration", () => {
    expect(computeAnalysisWindow("hook", 0, 0, 10, 18)).toEqual({
      fromSeconds: 0,
      toSeconds: 18,
    })
  })

  it("pads a drop-off 30s before to 10s after its midpoint", () => {
    expect(computeAnalysisWindow("drop_off", 0, 40, 50, 300)).toEqual({
      fromSeconds: 15,
      toSeconds: 55,
    })
  })

  it("pads a gain 10s before to 20s after its midpoint", () => {
    expect(computeAnalysisWindow("gain", 0, 100, 102, 300)).toEqual({
      fromSeconds: 91,
      toSeconds: 121,
    })
  })

  it("clamps the lower bound to 0 for an early gain", () => {
    expect(computeAnalysisWindow("gain", 0, 4, 6, 300)).toEqual({
      fromSeconds: 0,
      toSeconds: 25,
    })
  })

  it("clamps the upper bound to the video's duration", () => {
    expect(computeAnalysisWindow("drop_off", 0, 290, 295, 300)).toEqual({
      fromSeconds: 262.5,
      toSeconds: 300,
    })
  })

  it("returns null when clamping degenerates the window to zero length", () => {
    // An anchor far beyond a (implausibly short) reported duration: the upper
    // clamp lands at/before the lower clamp.
    expect(computeAnalysisWindow("drop_off", 0, 340, 350, 5)).toBeNull()
  })
})
