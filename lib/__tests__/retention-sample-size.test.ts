import { describe, expect, it } from "vitest"

import {
  assessComparisonReliability,
  differenceMarginOfError,
  gapChangeMarginOfError,
  marginOfError,
  proportionStandardError,
  reliabilityNote,
  worstCasePointMargin,
} from "@/lib/retention-sample-size"

describe("proportionStandardError", () => {
  it("returns null without a usable sample size", () => {
    expect(proportionStandardError(0.5, null)).toBeNull()
    expect(proportionStandardError(0.5, 0)).toBeNull()
    expect(proportionStandardError(0.5, -10)).toBeNull()
  })

  it("shrinks as the audience grows", () => {
    const small = proportionStandardError(0.5, 80)!
    const large = proportionStandardError(0.5, 8_000)!
    expect(small).toBeGreaterThan(large)
    // Ten times the sample is sqrt(10) times tighter, twice over.
    expect(small / large).toBeCloseTo(10, 1)
  })

  it("clamps proportions outside 0..1 rather than taking a root of a negative", () => {
    expect(proportionStandardError(1.4, 100)).toBe(0)
    expect(proportionStandardError(-0.2, 100)).toBe(0)
  })
})

describe("marginOfError", () => {
  it("is about 11 points at 80 viewers and about 2 at 2,000", () => {
    expect(marginOfError(0.5, 80)!).toBeCloseTo(0.11, 2)
    expect(marginOfError(0.5, 2_000)!).toBeCloseTo(0.022, 3)
  })

  it("narrows towards the tails of the curve", () => {
    // A curve ending at 9% is measured more precisely than one at 50%, even
    // from the same audience.
    expect(marginOfError(0.09, 80)!).toBeLessThan(marginOfError(0.5, 80)!)
  })
})

describe("worstCasePointMargin", () => {
  it("is the margin at p = 0.5, where proportion variance peaks", () => {
    expect(worstCasePointMargin(80)).toBe(marginOfError(0.5, 80))
  })

  it("is null when the audience is unknown", () => {
    expect(worstCasePointMargin(null)).toBeNull()
  })
})

describe("differenceMarginOfError", () => {
  // The case from the report that prompted this work: a 4.5 point ending gap
  // between a 2,000 view video and an 80 view one.
  it("swallows a 4.5 point gap when one side has 80 viewers", () => {
    const margin = differenceMarginOfError(0.043, 2_000, 0.088, 80)!
    expect(margin).toBeGreaterThan(0.045)
    expect(margin).toBeCloseTo(0.063, 2)
  })

  it("resolves the same gap once both audiences are large", () => {
    const margin = differenceMarginOfError(0.043, 2_000, 0.088, 2_000)!
    expect(margin).toBeLessThan(0.045)
  })

  it("is null when either audience is unknown", () => {
    expect(differenceMarginOfError(0.4, null, 0.5, 2_000)).toBeNull()
    expect(differenceMarginOfError(0.4, 2_000, 0.5, null)).toBeNull()
  })
})

describe("gapChangeMarginOfError", () => {
  it("is driven by the smaller audience", () => {
    const margin = gapChangeMarginOfError(0.51, 2_000, 0.18, 80)!
    const smallSideAlone = gapChangeMarginOfError(0.51, 1e9, 0.18, 80)!
    expect(margin).toBeCloseTo(smallSideAlone, 2)
  })

  it("stays below a genuinely wide divergence", () => {
    // The screenshot pair: A drops 51 points across the stretch where B drops
    // 18, so the 33 point gap change clears its own margin comfortably.
    expect(gapChangeMarginOfError(0.51, 2_000, 0.18, 80)!).toBeLessThan(0.33)
  })

  it("handles a rising curve, whose drop across a stretch is negative", () => {
    expect(gapChangeMarginOfError(-0.1, 500, 0.2, 500)).toBeCloseTo(
      gapChangeMarginOfError(0.1, 500, 0.2, 500)!,
    )
  })
})

describe("assessComparisonReliability", () => {
  const large = { sampleSizeA: 4_000, sampleSizeB: 3_500 }

  it("compares on level and shape when both audiences are large and apart", () => {
    const reliability = assessComparisonReliability({
      ...large,
      endingRatioA: 0.32,
      endingRatioB: 0.11,
    })
    expect(reliability.caveats).toEqual([])
    expect(reliability.comparable).toBe("level_and_shape")
    expect(reliability.endingGapIsSignificant).toBe(true)
  })

  it("falls back to shape only when one side has too few viewers", () => {
    const reliability = assessComparisonReliability({
      sampleSizeA: 2_000,
      sampleSizeB: 80,
      endingRatioA: 0.043,
      endingRatioB: 0.088,
    })
    expect(reliability.comparable).toBe("shape_only")
    expect(reliability.caveats).toContain("small_sample")
    expect(reliability.caveats).toContain("lopsided_samples")
    // The 4.5 point ending gap does not clear its 6.3 point margin.
    expect(reliability.endingGapIsSignificant).toBe(false)
    expect(reliability.caveats).toContain("gap_within_noise")
  })

  it("flags lopsided audiences even when both are individually large", () => {
    const reliability = assessComparisonReliability({
      sampleSizeA: 400_000,
      sampleSizeB: 900,
      endingRatioA: 0.4,
      endingRatioB: 0.1,
    })
    expect(reliability.caveats).toEqual(["lopsided_samples"])
    expect(reliability.comparable).toBe("shape_only")
    // The gap itself is real; it is the traffic mix that is not controlled for.
    expect(reliability.endingGapIsSignificant).toBe(true)
  })

  it("flags two large audiences that simply finish level", () => {
    const reliability = assessComparisonReliability({
      ...large,
      endingRatioA: 0.3,
      endingRatioB: 0.305,
    })
    expect(reliability.caveats).toEqual(["gap_within_noise"])
    expect(reliability.comparable).toBe("shape_only")
  })

  it("reports unknown when either view count is missing", () => {
    const reliability = assessComparisonReliability({
      sampleSizeA: null,
      sampleSizeB: 3_000,
      endingRatioA: 0.2,
      endingRatioB: 0.4,
    })
    expect(reliability.comparable).toBe("unknown")
    expect(reliability.endingGapIsSignificant).toBeNull()
    expect(reliability.caveats).toEqual([])
  })
})

describe("reliabilityNote", () => {
  const noteFor = (input: Parameters<typeof assessComparisonReliability>[0]) =>
    reliabilityNote(assessComparisonReliability(input))

  it("says nothing when the pair is fully comparable", () => {
    expect(
      noteFor({
        sampleSizeA: 4_000,
        sampleSizeB: 3_500,
        endingRatioA: 0.32,
        endingRatioB: 0.11,
      }),
    ).toBeNull()
  })

  it("names the small audience and redirects to shape", () => {
    const note = noteFor({
      sampleSizeA: 2_000,
      sampleSizeB: 80,
      endingRatioA: 0.043,
      endingRatioB: 0.088,
    })!
    expect(note).toContain("80 viewers")
    expect(note).toContain("where each video loses people")
  })

  it("explains traffic mix when only the audiences are lopsided", () => {
    const note = noteFor({
      sampleSizeA: 400_000,
      sampleSizeB: 900,
      endingRatioA: 0.4,
      endingRatioB: 0.1,
    })!
    expect(note).toContain("traffic")
  })

  it("says two level finishers finished level", () => {
    const note = noteFor({
      sampleSizeA: 4_000,
      sampleSizeB: 3_500,
      endingRatioA: 0.3,
      endingRatioB: 0.305,
    })!
    expect(note).toContain("margin of error")
  })
})
