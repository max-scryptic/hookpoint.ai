import { describe, expect, it } from "vitest"

import {
  computeRetentionWindows,
  type RetentionPoint,
} from "@/lib/youtube/youtube"

function point(timestampSeconds: number, watchRatio: number): RetentionPoint {
  return {
    elapsedRatio: timestampSeconds / 100,
    watchRatio,
    relativePerformance: null,
    timestampSeconds,
  }
}

describe("computeRetentionWindows", () => {
  it("computes hook losses as a continuous funnel starting at 100%", () => {
    const windows = computeRetentionWindows(
      [point(0, 0.908), point(10, 0.77), point(30, 0.6)],
      100,
    )

    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({
      id: "initial-hook",
      startWatchRatio: 1,
      endWatchRatio: 0.77,
    })
    expect(windows[0].drop).toBeCloseTo(0.23)
    expect(windows[1]).toMatchObject({
      id: "hook-delivery",
      startWatchRatio: 0.77,
      endWatchRatio: 0.6,
    })
    expect(windows[1].drop).toBeCloseTo(0.17)
  })

  it("never reports negative loss when retention rises", () => {
    const windows = computeRetentionWindows(
      [point(0, 0.9), point(10, 0.77), point(30, 0.8)],
      100,
    )

    expect(windows[1].drop).toBe(0)
  })
})
