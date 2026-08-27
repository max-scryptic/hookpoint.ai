import { describe, expect, it } from "vitest"

import {
  COVERAGE_CEILING,
  CUTS_PER_MINUTE_CEILING,
  MOTION_CEILING,
  SPEECH_RATE_CEILING,
  toDeliveryRead,
  type DeliveryBaseline,
} from "@/lib/channel-delivery"
import type { SparseVideoFeatureBaseline } from "@/lib/video-feature-baseline"

function baseline(overrides: Partial<DeliveryBaseline> = {}): DeliveryBaseline {
  return {
    cutsPerMinute: 15,
    motion: 0.1,
    speechRate: 110,
    freezeCoverage: 0.2,
    blackCoverage: 0,
    sampledSeconds: 120,
    videoDurationSeconds: 600,
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("toDeliveryRead", () => {
  it("returns null with no baseline at all", () => {
    expect(toDeliveryRead(null)).toBeNull()
    expect(toDeliveryRead(undefined)).toBeNull()
  })

  it("returns null when every figure failed to measure", () => {
    expect(
      toDeliveryRead({
        cutsPerMinute: null,
        motion: null,
        speechRate: null,
        freezeCoverage: null,
        blackCoverage: null,
        sampledSeconds: 120,
        videoDurationSeconds: 600,
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeNull()
  })

  it("scales a figure at half its ceiling onto the middle of the axis", () => {
    const read = toDeliveryRead(
      baseline({
        cutsPerMinute: CUTS_PER_MINUTE_CEILING / 2,
        motion: MOTION_CEILING / 2,
        speechRate: SPEECH_RATE_CEILING / 2,
        freezeCoverage: COVERAGE_CEILING / 2,
        blackCoverage: COVERAGE_CEILING / 2,
      }),
    )
    expect(read?.detail).toEqual({
      cutsPerMinute: 5,
      motion: 5,
      speechRate: 5,
      freezeCoverage: 5,
      blackCoverage: 5,
    })
  })

  it("puts a figure at its ceiling at the top of the axis", () => {
    const read = toDeliveryRead(
      baseline({ cutsPerMinute: CUTS_PER_MINUTE_CEILING }),
    )
    expect(read?.detail.cutsPerMinute).toBe(10)
  })

  it("clamps rather than overflowing past the ceiling", () => {
    const read = toDeliveryRead(
      baseline({
        cutsPerMinute: CUTS_PER_MINUTE_CEILING * 4,
        motion: MOTION_CEILING * 3,
        speechRate: SPEECH_RATE_CEILING * 2,
      }),
    )
    expect(read?.detail.cutsPerMinute).toBe(10)
    expect(read?.detail.motion).toBe(10)
    expect(read?.detail.speechRate).toBe(10)
  })

  it("floors a negative figure at zero rather than drawing it off the axis", () => {
    const read = toDeliveryRead(baseline({ cutsPerMinute: -4 }))
    expect(read?.detail.cutsPerMinute).toBe(0)
  })

  it("holds every scaled figure to one decimal", () => {
    // A third of the ceiling scales to 3.333..., which would otherwise put float
    // noise either side of the contrast threshold the profiles compare against.
    const read = toDeliveryRead(
      baseline({ cutsPerMinute: CUTS_PER_MINUTE_CEILING / 3 }),
    )
    expect(read?.detail.cutsPerMinute).toBe(3.3)
  })

  it("keeps a partly measured baseline, nulling only what failed", () => {
    const read = toDeliveryRead(baseline({ motion: null, blackCoverage: null }))
    expect(read).not.toBeNull()
    expect(read?.detail.motion).toBeNull()
    expect(read?.detail.blackCoverage).toBeNull()
    expect(read?.detail.cutsPerMinute).toBe(5)
  })

  it("drops a figure that is not a finite number", () => {
    const read = toDeliveryRead(baseline({ motion: Number.NaN }))
    expect(read?.detail.motion).toBeNull()
    expect(read?.raw.motion).toBeNull()
  })

  it("carries the raw figures through in their own units", () => {
    const read = toDeliveryRead(baseline({ cutsPerMinute: 22, speechRate: 145 }))
    expect(read?.raw.cutsPerMinute).toBe(22)
    expect(read?.raw.speechRate).toBe(145)
  })

  it("carries the sample the figures were measured over", () => {
    const read = toDeliveryRead(baseline())
    expect(read?.sampledSeconds).toBe(120)
    expect(read?.videoDurationSeconds).toBe(600)
    expect(read?.generatedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  it("scales a zero rather than treating it as unmeasured", () => {
    // A video with no cuts at all is a real reading and belongs at the floor of
    // the axis; only a null means the measurement never happened.
    const read = toDeliveryRead(baseline({ cutsPerMinute: 0 }))
    expect(read?.detail.cutsPerMinute).toBe(0)
    expect(read?.raw.cutsPerMinute).toBe(0)
  })

  it("accepts a whole stored baseline unchanged", () => {
    // The type this reads is a structural subset, so the persisted shape has to
    // satisfy it without the caller picking fields off it first.
    const stored: SparseVideoFeatureBaseline = {
      schemaVersion: 1,
      generatedAt: "2026-02-02T00:00:00.000Z",
      videoDurationSeconds: 300,
      sampledSeconds: 40,
      ranges: [{ fromSeconds: 0, toSeconds: 8 }],
      cutsPerMinute: CUTS_PER_MINUTE_CEILING,
      freezeCoverage: 0,
      blackCoverage: 0,
      motion: null,
      speechRate: null,
    }
    const read = toDeliveryRead(stored)
    expect(read?.detail.cutsPerMinute).toBe(10)
    expect(read?.generatedAt).toBe("2026-02-02T00:00:00.000Z")
  })
})
