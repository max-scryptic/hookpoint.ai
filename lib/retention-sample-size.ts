// The statistics behind an honest retention head-to-head. A retention curve is
// a survival curve estimated from a finite audience, so every point on it
// carries sampling error, and two curves built from very differently sized
// audiences cannot be read against each other the way two curves from similar
// audiences can. Everything here is pure arithmetic over watch ratios (0..1)
// and viewer counts, so it is exercised directly by tests.
//
// Two separate problems are modelled here, and only the first one is
// statistical:
//
//   1. Sampling noise. A share still watching is a proportion estimated from n
//      viewers, so it carries a standard error of sqrt(p(1-p)/n). At n=80 the
//      95% margin on a mid-curve point is around 10 watch-ratio points, which
//      is wider than most gaps this comparison would otherwise be willing to
//      call a divergence. This is what the intervals below quantify.
//   2. Composition bias. A video with many more views reached colder traffic
//      than one with few, and cold traffic drops harder early, so a low-view
//      video often shows a flatter mid-curve for reasons that have nothing to
//      do with its content. That is real signal about a different question, and
//      no interval fixes it. The only honest treatment is to name it and narrow
//      what the comparison is willing to claim, which is what the caveats do.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included) - it feeds the Channel Trends surface. Hyphens are fine.

// z for a two-sided 95% interval.
const Z_95 = 1.96

// Below this many viewers a curve is too noisy to carry a claim about how much
// audience it held, only about where it lost people. Roughly the point at which
// the 95% margin on a mid-curve share drops under 6 watch-ratio points.
export const LOW_SAMPLE_VIEWS = 250

// Above this ratio between the two audiences the traffic mixes are different
// enough that composition, not content, is a live explanation for the gap.
export const LOPSIDED_SAMPLE_RATIO = 10

// Standard error of a proportion estimated from n viewers. Null when there is
// no usable sample size, which is the signal to fall back to the fixed floors
// rather than to invent an interval.
export function proportionStandardError(
  proportion: number,
  sampleSize: number | null,
): number | null {
  if (sampleSize == null || sampleSize <= 0) return null
  const p = Math.min(1, Math.max(0, proportion))
  return Math.sqrt((p * (1 - p)) / sampleSize)
}

// The 95% margin of error on a single point of one curve, in watch-ratio points
// (0..1, matching the curve's own units).
export function marginOfError(
  proportion: number,
  sampleSize: number | null,
): number | null {
  const standardError = proportionStandardError(proportion, sampleSize)
  return standardError == null ? null : Z_95 * standardError
}

// One video's contribution to a weighted average of the same point across
// several curves: the share it reported, the weight it carries in the average,
// and the audience its share was estimated from.
export interface WeightedProportion {
  proportion: number
  weight: number
  sampleSize: number | null
}

// The 95% margin on a weighted average of proportions, each estimated from its
// own audience. The Channel Trends average curve weights every video by the
// viewers behind it, so the average's precision is not any one video's
// precision: each contribution carries variance p(1-p)/n, and a weighted mean
// carries the sum of those variances scaled by the square of each
// contribution's share of the total weight. Weighting by viewers is what makes
// that sum small, because it is inverse-variance weighting: the noisy curves
// are exactly the ones held down.
//
// Null when the weights are empty or when any contributing curve has no usable
// audience behind it, since a missing n cannot be read as zero variance
// without inventing certainty the average does not have.
export function weightedProportionMarginOfError(
  contributions: readonly WeightedProportion[],
): number | null {
  let totalWeight = 0
  for (const contribution of contributions) {
    totalWeight += Math.max(0, contribution.weight)
  }
  if (totalWeight <= 0) return null

  let variance = 0
  for (const contribution of contributions) {
    const weight = Math.max(0, contribution.weight)
    if (weight <= 0) continue
    const standardError = proportionStandardError(
      contribution.proportion,
      contribution.sampleSize,
    )
    if (standardError == null) return null
    const share = weight / totalWeight
    variance += share * share * standardError * standardError
  }
  return Z_95 * Math.sqrt(variance)
}

// The widest 95% margin any single point on a curve estimated from n viewers
// can carry. Proportion variance peaks at p = 0.5, so this is the one number
// that describes a whole curve's precision without picking a position on it:
// at 80 viewers it is about 11 watch-ratio points, at 2,000 about 2.
export function worstCasePointMargin(sampleSize: number | null): number | null {
  return marginOfError(0.5, sampleSize)
}

// The 95% margin on the difference between the same point on two curves, which
// is what any "held 8.8% versus 4.3%" claim actually rests on. The two videos
// have independent audiences, so the variances add.
export function differenceMarginOfError(
  proportionA: number,
  sampleSizeA: number | null,
  proportionB: number,
  sampleSizeB: number | null,
): number | null {
  const errorA = proportionStandardError(proportionA, sampleSizeA)
  const errorB = proportionStandardError(proportionB, sampleSizeB)
  if (errorA == null || errorB == null) return null
  return Z_95 * Math.sqrt(errorA * errorA + errorB * errorB)
}

// The 95% margin on how much the gap between two curves changed across a
// stretch, which is what the divergence search reports.
//
// The curves are survival curves, so everyone still watching at the end of a
// stretch is a subset of everyone watching at its start: the drop across the
// stretch is itself a proportion of the video's starting audience, with
// variance q(1-q)/n. That is why this is not the sum of two point margins,
// which would double count the shared audience and overstate the noise.
//
// A stretch where a curve rises (a rewatch spike) has a negative drop, which
// the proportion variance is not defined for, so its magnitude is used.
export function gapChangeMarginOfError(
  dropA: number,
  sampleSizeA: number | null,
  dropB: number,
  sampleSizeB: number | null,
): number | null {
  const errorA = proportionStandardError(Math.abs(dropA), sampleSizeA)
  const errorB = proportionStandardError(Math.abs(dropB), sampleSizeB)
  if (errorA == null || errorB == null) return null
  return Z_95 * Math.sqrt(errorA * errorA + errorB * errorB)
}

// Why a pair cannot be compared on how much audience each one held. Ordered by
// how much they narrow the reading, most limiting first.
export type ReliabilityCaveat =
  // One side has too few viewers for any level on its curve to be stable.
  | "small_sample"
  // The two audiences differ enough in size that their traffic mixes, rather
  // than anything in the videos, may explain the gap.
  | "lopsided_samples"
  // The two videos finish within each other's margin of error, so the ending
  // difference is not distinguishable from noise.
  | "gap_within_noise"

// What a pair of curves can honestly be compared on.
//   level_and_shape: both how much each video held and where each lost people.
//   shape_only: only where each video lost people, relative to its own start.
//   unknown: no view counts stored, so neither can be checked.
export type ComparabilityVerdict = "level_and_shape" | "shape_only" | "unknown"

export interface ComparisonReliability {
  sampleSizeA: number | null
  sampleSizeB: number | null
  // 95% margins on each side's ending share, in watch-ratio points.
  endingMarginA: number | null
  endingMarginB: number | null
  // The ending difference and the 95% margin on that difference. A gap smaller
  // than its margin is not evidence that either video finished ahead.
  endingGap: number | null
  endingGapMargin: number | null
  endingGapIsSignificant: boolean | null
  caveats: ReliabilityCaveat[]
  comparable: ComparabilityVerdict
}

// Reads a pair's view counts and ending shares into the verdict the rest of the
// comparison is bound by: what may be claimed, and what has to be hedged.
export function assessComparisonReliability(input: {
  sampleSizeA: number | null
  sampleSizeB: number | null
  endingRatioA: number | null
  endingRatioB: number | null
}): ComparisonReliability {
  const { sampleSizeA, sampleSizeB, endingRatioA, endingRatioB } = input

  const endingMarginA =
    endingRatioA != null ? marginOfError(endingRatioA, sampleSizeA) : null
  const endingMarginB =
    endingRatioB != null ? marginOfError(endingRatioB, sampleSizeB) : null

  const endingGap =
    endingRatioA != null && endingRatioB != null
      ? Math.abs(endingRatioA - endingRatioB)
      : null
  const endingGapMargin =
    endingRatioA != null && endingRatioB != null
      ? differenceMarginOfError(
          endingRatioA,
          sampleSizeA,
          endingRatioB,
          sampleSizeB,
        )
      : null
  const endingGapIsSignificant =
    endingGap != null && endingGapMargin != null
      ? endingGap > endingGapMargin
      : null

  const caveats: ReliabilityCaveat[] = []
  const known = sampleSizeA != null && sampleSizeB != null

  if (known) {
    const smallest = Math.min(sampleSizeA, sampleSizeB)
    const largest = Math.max(sampleSizeA, sampleSizeB)
    if (smallest < LOW_SAMPLE_VIEWS) caveats.push("small_sample")
    if (smallest > 0 && largest / smallest > LOPSIDED_SAMPLE_RATIO) {
      caveats.push("lopsided_samples")
    }
  }
  if (endingGapIsSignificant === false) caveats.push("gap_within_noise")

  return {
    sampleSizeA,
    sampleSizeB,
    endingMarginA,
    endingMarginB,
    endingGap,
    endingGapMargin,
    endingGapIsSignificant,
    caveats,
    comparable: !known ? "unknown" : caveats.length > 0 ? "shape_only" : "level_and_shape",
  }
}

// The sentence the Retention tab shows under the curves when a pair cannot
// carry a claim about how much audience each video held. Null when the pair is
// comparable on both level and shape, which needs no warning. Kept here rather
// than in the component so the copy and the verdict it describes cannot drift
// apart.
export function reliabilityNote(
  reliability: ComparisonReliability,
): string | null {
  const { caveats, sampleSizeA, sampleSizeB } = reliability
  if (caveats.length === 0) return null

  const smallest =
    sampleSizeA != null && sampleSizeB != null
      ? Math.min(sampleSizeA, sampleSizeB)
      : null

  if (caveats.includes("small_sample")) {
    const audience =
      smallest != null ? `only ${smallest.toLocaleString("en")} viewers` : "few viewers"
    const lopsided = caveats.includes("lopsided_samples")
      ? " Their audiences also differ enough in size that traffic mix, rather than anything in the videos, could explain part of the gap."
      : ""
    return (
      `One of these videos was watched by ${audience}, so every point on its curve carries a wide margin of error.` +
      lopsided +
      ` Read this comparison for where each video loses people, not for how much of its audience each one kept.`
    )
  }

  if (caveats.includes("lopsided_samples")) {
    return (
      "These two videos reached very differently sized audiences, so their traffic mixes differ too, and colder traffic drops harder early. " +
      "Read this comparison for where each video loses people rather than for which curve sits higher."
    )
  }

  return (
    "These two videos finish within each other's margin of error, so neither one held measurably more of its audience than the other. " +
    "Where each curve loses people is still worth reading."
  )
}
