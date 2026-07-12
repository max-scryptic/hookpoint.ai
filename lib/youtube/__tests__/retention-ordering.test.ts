import { describe, expect, it } from "vitest"

import {
  detectDropOffs,
  detectRetentionGains,
  detectSignificantDropOffs,
  type RetentionPoint,
} from "@/lib/youtube/youtube"

function point(timestampSeconds: number, watchRatio: number): RetentionPoint {
  return {
    elapsedRatio: timestampSeconds / 100,
    timestampSeconds,
    watchRatio,
    relativePerformance: 0.6,
  }
}

describe("retention insight ordering", () => {
  it("returns the strongest losses in chronological order", () => {
    const retention = [
      point(0, 1),
      point(10, 0.96),
      point(20, 0.86),
      point(30, 0.8),
      point(40, 0.68),
    ]

    expect(
      detectDropOffs(retention, { limit: 3 }).map(
        (drop) => drop.fromTimestampSeconds,
      ),
    ).toEqual([10, 20, 30])
  })

  it("returns the strongest gains in chronological order", () => {
    const retention = [
      point(0, 0.6),
      point(10, 0.64),
      point(20, 0.63),
      point(30, 0.73),
      point(40, 0.72),
      point(50, 0.84),
    ]

    expect(
      detectRetentionGains(retention, { limit: 3 }).map(
        (gain) => gain.fromTimestampSeconds,
      ),
    ).toEqual([0, 20, 40])
  })

  it("orders selected significant losses chronologically", () => {
    const retention = [
      point(0, 1),
      point(10, 0.99),
      point(20, 0.98),
      point(30, 0.97),
      point(40, 0.93),
      point(50, 0.94),
      point(60, 0.84),
      point(70, 0.85),
      point(80, 0.73),
    ]

    expect(
      detectSignificantDropOffs(retention, {
        ignoreBeforeSeconds: 0,
        steepnessFactor: 1,
        limit: 3,
      }).map((drop) => drop.fromTimestampSeconds),
    ).toEqual([30, 50, 70])
  })

  it("groups adjacent gains into one cumulative episode", () => {
    const retention = [
      point(0, 0.6),
      point(10, 0.62),
      point(20, 0.64),
      point(30, 0.63),
    ]

    expect(detectRetentionGains(retention)).toEqual([
      {
        fromTimestampSeconds: 0,
        toTimestampSeconds: 20,
        watchRatioGain: 0.040000000000000036,
      },
    ])
  })

  it("groups adjacent significant losses into one episode", () => {
    const retention = [
      point(0, 1),
      point(10, 0.995),
      point(20, 0.99),
      point(30, 0.985),
      point(40, 0.965),
      point(50, 0.945),
      point(60, 0.94),
    ]

    const drops = detectSignificantDropOffs(retention, {
      ignoreBeforeSeconds: 0,
    })

    expect(drops).toHaveLength(1)
    expect(drops[0].fromTimestampSeconds).toBe(30)
    expect(drops[0].toTimestampSeconds).toBe(50)
    expect(drops[0].watchRatioDrop).toBeCloseTo(0.04)
  })

  it("never surfaces a drop-off whose window starts inside the hook", () => {
    // A steep step that straddles the 30s hook boundary (25s -> 35s). It must
    // be skipped: gating on the window's end would keep it and store a drop-off
    // starting at 25s, overlapping the hook section.
    const retention = [
      point(0, 1),
      point(25, 0.9),
      point(35, 0.5),
      point(45, 0.45),
    ]

    const drops = detectSignificantDropOffs(retention, { steepnessFactor: 1 })

    expect(drops.every((drop) => drop.fromTimestampSeconds >= 30)).toBe(true)
    expect(
      drops.some((drop) => drop.fromTimestampSeconds === 25),
    ).toBe(false)
  })
})
