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
      point(20, 0.74),
      point(30, 0.8),
      point(40, 0.92),
    ]

    expect(
      detectRetentionGains(retention, { limit: 3 }).map(
        (gain) => gain.fromTimestampSeconds,
      ),
    ).toEqual([10, 20, 30])
  })

  it("orders selected significant losses chronologically", () => {
    const retention = [
      point(0, 1),
      point(10, 0.99),
      point(20, 0.98),
      point(30, 0.97),
      point(40, 0.93),
      point(50, 0.83),
      point(60, 0.77),
      point(70, 0.65),
    ]

    expect(
      detectSignificantDropOffs(retention, {
        ignoreBeforeSeconds: 0,
        steepnessFactor: 1,
        limit: 3,
      }).map((drop) => drop.fromTimestampSeconds),
    ).toEqual([40, 50, 60])
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
