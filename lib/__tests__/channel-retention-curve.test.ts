import { describe, expect, it } from "vitest"

import {
  buildChannelRetentionCurve,
  cappedViewWeights,
  channelCurveMaxWeightShare,
  CHANNEL_CURVE_GRID_POINTS,
  type ChannelRetentionVideoInput,
} from "@/lib/channel-retention-curve"
import type { RetentionPoint } from "@/lib/youtube/youtube"

// A curve that falls linearly from 100% at the start to `endRatio` at the end,
// sampled at the same 1% granularity YouTube reports.
function linearCurve(endRatio: number): RetentionPoint[] {
  return Array.from({ length: 101 }, (_, index) => {
    const elapsedRatio = index / 100
    return {
      elapsedRatio,
      watchRatio: 1 - (1 - endRatio) * elapsedRatio,
      relativePerformance: null,
      timestampSeconds: elapsedRatio * 600,
    }
  })
}

// A curve that alternates hard either side of `middle` at every sample: what a
// video watched by a handful of people actually looks like.
function jaggedCurve(middle: number, swing: number): RetentionPoint[] {
  return Array.from({ length: 101 }, (_, index) => {
    const elapsedRatio = index / 100
    return {
      elapsedRatio,
      watchRatio: middle + (index % 2 === 0 ? swing : -swing),
      relativePerformance: null,
      timestampSeconds: elapsedRatio * 600,
    }
  })
}

function video(
  id: string,
  views: number | null,
  retention: RetentionPoint[] | null,
  durationSeconds: number | null = 600,
): ChannelRetentionVideoInput {
  return { id, title: id, views, retention, durationSeconds }
}

function at(
  curve: NonNullable<ReturnType<typeof buildChannelRetentionCurve>>,
  ratio: number,
) {
  return curve.points[Math.round(ratio * (CHANNEL_CURVE_GRID_POINTS - 1))]
}

describe("cappedViewWeights", () => {
  it("leaves weights proportional to views when none exceeds the cap", () => {
    expect(cappedViewWeights([10, 10, 10], 0.4)).toEqual([10, 10, 10])
  })

  it("caps a runaway video at its share of the total", () => {
    const weights = cappedViewWeights([100, 1, 1], 0.4)
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    expect(weights[0] / total).toBeCloseTo(0.4, 10)
    // The small uploads keep their relative standing under the cap.
    expect(weights[1]).toBe(1)
    expect(weights[2]).toBe(1)
  })

  it("caps every video that would otherwise breach the limit", () => {
    const weights = cappedViewWeights([500, 400, 10, 10], 0.4)
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    expect(weights[0] / total).toBeLessThanOrEqual(0.4 + 1e-9)
    expect(weights[1] / total).toBeLessThanOrEqual(0.4 + 1e-9)
    // Still ordered by views: capping never lets a smaller video outweigh a
    // bigger one.
    expect(weights[0]).toBeGreaterThanOrEqual(weights[1])
    expect(weights[1]).toBeGreaterThan(weights[2])
  })

  it("relaxes a cap a small library cannot satisfy", () => {
    // Two videos cannot each stay under 40%, so the tightest available cap is
    // an even split rather than an impossible one.
    const weights = cappedViewWeights([100, 1], 0.4)
    expect(weights[0]).toBe(weights[1])
  })

  it("handles an empty library", () => {
    expect(cappedViewWeights([], 0.4)).toEqual([])
  })
})

describe("channelCurveMaxWeightShare", () => {
  it("leaves a small library effectively uncapped and tightens as it grows", () => {
    // Capping hands whatever it takes off the big videos to the small ones, so
    // on a three-video library a 40% cap would promote the noisiest curve to a
    // fifth of the average. The limit stays loose until the library can absorb
    // it.
    expect(channelCurveMaxWeightShare(3)).toBeCloseTo(2 / 3, 10)
    expect(channelCurveMaxWeightShare(4)).toBeCloseTo(0.5, 10)
    expect(channelCurveMaxWeightShare(5)).toBeCloseTo(0.4, 10)
    expect(channelCurveMaxWeightShare(20)).toBeCloseTo(0.4, 10)
  })
})

describe("buildChannelRetentionCurve", () => {
  it("withholds a curve until three videos carry one with a view count", () => {
    expect(
      buildChannelRetentionCurve([
        video("a", 1000, linearCurve(0.3)),
        video("b", 1000, linearCurve(0.5)),
      ]),
    ).toBeNull()
  })

  it("ignores videos with a curve but no view count, and says how many", () => {
    const curve = buildChannelRetentionCurve([
      video("a", 1000, linearCurve(0.4)),
      video("b", 1000, linearCurve(0.4)),
      video("c", 1000, linearCurve(0.4)),
      video("d", null, linearCurve(0.9)),
    ])
    expect(curve).not.toBeNull()
    expect(curve!.videoCount).toBe(3)
    expect(curve!.unweightedVideoCount).toBe(1)
    // The unweightable video's much flatter curve left the average alone.
    expect(curve!.holdAtEnd).toBeCloseTo(0.4, 6)
  })

  it("ignores videos with no stored curve at all", () => {
    expect(
      buildChannelRetentionCurve([
        video("a", 1000, linearCurve(0.4)),
        video("b", 1000, linearCurve(0.4)),
        video("c", 1000, null),
      ]),
    ).toBeNull()
  })

  it("weights the average by viewers, not by video", () => {
    const curve = buildChannelRetentionCurve([
      video("big", 100_000, linearCurve(0.5)),
      video("small-1", 100, linearCurve(0.1)),
      video("small-2", 100, linearCurve(0.1)),
    ])
    expect(curve).not.toBeNull()
    // An even average of the three would end at (0.5 + 0.1 + 0.1) / 3 = 0.233.
    // Weighted by viewers, the 100,000-view video leads the ending, held to
    // two thirds of the average by the cap this library size allows.
    expect(curve!.videos[0].weightShare).toBeCloseTo(2 / 3, 10)
    expect(curve!.holdAtEnd).toBeCloseTo(
      (2 / 3) * 0.5 + (1 / 6) * 0.1 + (1 / 6) * 0.1,
      6,
    )
  })

  it("holds a runaway upload to its capped share once the library is big enough", () => {
    const curve = buildChannelRetentionCurve([
      video("big", 1_000_000, linearCurve(0.5)),
      ...Array.from({ length: 5 }, (_, index) =>
        video(`small-${index}`, 2_000, linearCurve(0.1)),
      ),
    ])
    expect(curve).not.toBeNull()
    expect(curve!.videos[0].weightShare).toBeCloseTo(0.4, 10)
    // Uncapped, the breakout would be 99% of the average and the curve would
    // just be that one video.
    expect(curve!.holdAtEnd).toBeCloseTo(0.4 * 0.5 + 0.6 * 0.1, 6)
  })

  it("keeps a noisy low-view curve from wobbling the average", () => {
    const noisy = jaggedCurve(0.5, 0.3)
    const withNoise = buildChannelRetentionCurve([
      video("big-1", 50_000, linearCurve(0.5)),
      video("big-2", 50_000, linearCurve(0.5)),
      video("tiny", 80, noisy),
    ])
    const withoutNoise = buildChannelRetentionCurve([
      video("big-1", 50_000, linearCurve(0.5)),
      video("big-2", 50_000, linearCurve(0.5)),
      video("big-3", 50_000, linearCurve(0.5)),
    ])
    expect(withNoise).not.toBeNull()
    expect(withoutNoise).not.toBeNull()

    // The tiny video swings 60 watch-ratio points between neighbouring
    // samples. Its pull on the average is under a point at every position.
    for (let index = 0; index < CHANNEL_CURVE_GRID_POINTS; index++) {
      expect(
        Math.abs(
          withNoise!.points[index].watchRatio -
            withoutNoise!.points[index].watchRatio,
        ),
      ).toBeLessThan(0.01)
    }
  })

  it("starts at 100% with no margin and widens where the audience is thin", () => {
    const curve = buildChannelRetentionCurve([
      video("a", 200, linearCurve(0.5)),
      video("b", 200, linearCurve(0.5)),
      video("c", 200, linearCurve(0.5)),
    ])
    expect(curve).not.toBeNull()
    expect(curve!.points[0].watchRatio).toBe(1)
    expect(curve!.points[0].margin).toBe(0)

    const thin = at(curve!, 0.5).margin
    const wide = buildChannelRetentionCurve([
      video("a", 200_000, linearCurve(0.5)),
      video("b", 200_000, linearCurve(0.5)),
      video("c", 200_000, linearCurve(0.5)),
    ])
    expect(thin).not.toBeNull()
    // A thousand times the audience buys a far tighter interval on the same
    // shape.
    expect(thin!).toBeGreaterThan(at(wide!, 0.5).margin!)
  })

  it("reads the holds off the average and finds its steepest stretch", () => {
    // Flat for the first half, then a cliff, then flat again.
    const cliff: RetentionPoint[] = Array.from({ length: 101 }, (_, index) => {
      const elapsedRatio = index / 100
      const watchRatio =
        elapsedRatio <= 0.5 ? 1 : elapsedRatio <= 0.6 ? 1 - (elapsedRatio - 0.5) * 5 : 0.5
      return {
        elapsedRatio,
        watchRatio,
        relativePerformance: null,
        timestampSeconds: elapsedRatio * 600,
      }
    })
    const curve = buildChannelRetentionCurve([
      video("a", 5_000, cliff),
      video("b", 5_000, cliff),
      video("c", 5_000, cliff),
    ])
    expect(curve).not.toBeNull()
    expect(curve!.holdAtQuarter).toBeCloseTo(1, 6)
    expect(curve!.holdAtHalf).toBeCloseTo(1, 6)
    expect(curve!.holdAtEnd).toBeCloseTo(0.5, 6)
    expect(curve!.steepestDrop).not.toBeNull()
    expect(curve!.steepestDrop!.fromRatio).toBeCloseTo(0.5, 6)
    expect(curve!.steepestDrop!.toRatio).toBeCloseTo(0.6, 6)
    expect(curve!.steepestDrop!.lost).toBeCloseTo(0.5, 6)
  })

  it("resamples every video onto the shared grid and weights the runtime", () => {
    const curve = buildChannelRetentionCurve([
      video("a", 3_000, linearCurve(0.5), 60),
      video("b", 3_000, linearCurve(0.5), 60),
      video("c", 3_000, linearCurve(0.5), 1_200),
    ])
    expect(curve).not.toBeNull()
    expect(curve!.points).toHaveLength(CHANNEL_CURVE_GRID_POINTS)
    for (const contributor of curve!.videos) {
      expect(contributor.watchRatios).toHaveLength(CHANNEL_CURVE_GRID_POINTS)
    }
    expect(curve!.totalViews).toBe(9_000)
    // Equal weights, so the mean runtime is the plain average of the three.
    expect(curve!.averageDurationSeconds).toBeCloseTo(440, 6)
  })

  it("leaves the runtime unknown when no contributing video stored one", () => {
    const curve = buildChannelRetentionCurve([
      video("a", 3_000, linearCurve(0.5), null),
      video("b", 3_000, linearCurve(0.5), null),
      video("c", 3_000, linearCurve(0.5), null),
    ])
    expect(curve!.averageDurationSeconds).toBeNull()
  })
})
