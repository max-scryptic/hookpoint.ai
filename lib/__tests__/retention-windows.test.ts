import { describe, expect, it } from "vitest"

import { buildRetentionWindows } from "@/lib/retention-windows"
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
})
