// The channel's average audience-retention curve: every stored per-video curve
// resampled onto one shared axis and averaged, weighted by the viewers behind
// each video.
//
// The weighting is the whole point of this module. A retention curve is a
// survival curve estimated from however many people watched, so a video seen by
// 200 people carries a 95% margin of around 7 watch-ratio points at every
// position where one seen by 200,000 carries well under one (see
// lib/retention-sample-size.ts). Averaging those two evenly would let the noisy
// curve wobble the channel's shape exactly as hard as the smooth one, which is
// backwards. Weighting each video by its viewers is the inverse-variance
// weighting that makes the average as precise as the library allows, and it is
// why the result reads as a clean line rather than as the jitter of the
// smallest uploads.
//
// One cap sits on top of that. Pure viewer weighting hands a single breakout
// upload the entire average on a library where everything else is a fraction of
// its size, and "your average curve" would then be one video's curve under
// another name. No single video may carry more than
// channelCurveMaxWeightShare of the total, so a hit still leads the average
// without being it.
//
// The same arithmetic then runs over the two ends of the library on their own:
// the three best-retaining uploads averaged into one line, the three worst into
// another, with the whole library's average behind them as the baseline. That is
// the split every other Channel Trends tab is read against, so the retention
// chart answers the same question they do.
//
// Pure arithmetic over stored curves and view counts, so it is exercised
// directly by tests.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) anywhere in this
// file (comments included), because it feeds the Channel Trends surface.
// Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.test.ts.

import { watchRatioAt } from "@/lib/retention-comparison"
import {
  weightedProportionMarginOfError,
  type WeightedProportion,
} from "@/lib/retention-sample-size"
import type { RetentionPoint } from "@/lib/youtube/youtube"

// Below three curves an "average" is a coincidence of two uploads, not a
// channel shape. Matches the library's own early-trends threshold, so the
// curve appears on the same upload that unlocks the rest of the tab.
export const CHANNEL_CURVE_MIN_VIDEOS = 3

// The shared axis: 0%, 1%, ... 100% of each video's runtime. YouTube reports
// elapsedVideoTimeRatio at the same 1% granularity, so resampling onto this
// grid loses nothing, and a grid landing exactly on the quarter, the half and
// the end keeps the headline readouts off interpolated positions.
export const CHANNEL_CURVE_GRID_POINTS = 101

// A stored curve with only a handful of samples is a truncated fetch rather
// than a shape, and interpolating it across the whole axis would invent the
// stretches it never covered.
const MIN_STORED_CURVE_POINTS = 5

// The most of the average any one video may carry, however many viewers it
// took.
const MAX_VIDEO_WEIGHT_SHARE = 0.4

// The cap has to be relaxed on a small library, and not only because 40% each
// is unsatisfiable below three videos. A cap binds the videos it touches and
// then hands whatever it took off them to everything else, in proportion: cap
// two 50,000-view uploads at 40% on a three-video library and the remaining
// 20% goes to the third video however small it is, which would promote the
// noisiest curve in the library to a fifth of the average. So the cap is also
// expressed as a multiple of an even share, and the looser of the two applies.
// It leaves a three-video library effectively uncapped (two thirds), tightens
// to 40% from five videos, and holds there.
const MAX_EVEN_SHARE_MULTIPLE = 2

// The share limit that applies to a library of this size.
export function channelCurveMaxWeightShare(videoCount: number): number {
  return Math.min(
    1,
    Math.max(
      MAX_VIDEO_WEIGHT_SHARE,
      MAX_EVEN_SHARE_MULTIPLE / Math.max(1, videoCount),
    ),
  )
}

// The width of the stretch the steepest-drop search slides along the axis: a
// tenth of a video, which is long enough to be a stretch a creator can point at
// and short enough to name a specific moment.
const STEEPEST_DROP_SPAN = 0.1

// The two ends of the library, drawn as one averaged line each over the whole
// library's average. Same split, same band size and same reading as every other
// Channel Trends tab: three uploads at the top, three at the bottom, the library
// behind both as the baseline.
//
// The ranking is taken off the curves themselves, by the share of its runtime an
// average viewer watched (the area under the resampled curve), so the order the
// bands were picked in and the lines the page draws cannot disagree, and a video
// missing its analytics summary is still rankable.
export const RETENTION_BAND_SIZE = 3

// Both bands have to be full and disjoint before the comparison means anything.
export const RETENTION_BAND_MIN_VIDEOS = RETENTION_BAND_SIZE * 2

// One video as the average needs it. ChannelVideo satisfies this shape, so the
// page passes its library straight in.
export interface ChannelRetentionVideoInput {
  id: string
  title: string | null
  // Lifetime views from the analytics snapshot: the audience the curve was
  // estimated from, and so both the weight and the n behind its margin.
  views: number | null
  durationSeconds: number | null
  retention: RetentionPoint[] | null
}

export interface ChannelRetentionCurvePoint {
  // Share of an upload's runtime elapsed, 0..1.
  elapsedRatio: number
  // Views-weighted average share of viewers still watching, 0..1.
  watchRatio: number
  // The 95% margin on that average, in watch-ratio points. Zero at the start,
  // where every curve is 100% by definition rather than by estimate.
  margin: number | null
}

// One contributing video, resampled onto the shared grid so the page can draw
// it faintly behind the average and show what the average is made of.
export interface ChannelRetentionVideoCurve {
  id: string
  title: string | null
  views: number
  // Share (0..1) of the average this video carries, after capping.
  weightShare: number
  // One share still watching per grid position, in grid order.
  watchRatios: number[]
}

// One upload inside a band, named so the page can list what a line is made of.
// A creator recognises their own uploads faster than any curve, so the three
// titles are worth as much as the shape they average into.
export interface ChannelRetentionBandVideo {
  id: string
  title: string | null
  views: number
  // Share of its own runtime the average viewer watched, 0..1: the figure this
  // video was ranked on, and so the reason it landed in this band.
  watchedShare: number
}

// One end of the library, averaged onto the shared grid the same way the whole
// library is: views-weighted, under the same per-video cap, so a band is read on
// the same terms as the baseline behind it.
export interface ChannelRetentionBand {
  videoCount: number
  // The audience behind the band, summed across its videos.
  totalViews: number
  // One share still watching per grid position, in grid order.
  watchRatios: number[]
  // Share of runtime the band's average viewer watched, 0..1: the figure the
  // band was ranked on.
  watchedShare: number
  // The uploads averaged into the line, best-retaining first.
  videos: ChannelRetentionBandVideo[]
}

export interface ChannelRetentionBands {
  top: ChannelRetentionBand
  bottom: ChannelRetentionBand
}

// The steepest stretch of the average: where a tenth of an upload costs the
// channel the most audience.
export interface ChannelRetentionDrop {
  fromRatio: number
  toRatio: number
  // Watch-ratio points lost across the stretch, positive.
  lost: number
}

export interface ChannelRetentionCurve {
  points: ChannelRetentionCurvePoint[]
  videos: ChannelRetentionVideoCurve[]
  videoCount: number
  // The audience behind the whole average, summed across its videos.
  totalViews: number
  // Videos that stored a curve but no view count, so they could not be weighted
  // and were left out. Named on the page rather than hidden.
  unweightedVideoCount: number
  // Views-weighted mean runtime, so a position on the axis can be read back as
  // a rough timestamp. Null when no contributing video stored a duration.
  averageDurationSeconds: number | null
  // Share still watching a quarter in, halfway, and at the end.
  holdAtQuarter: number
  holdAtHalf: number
  holdAtEnd: number
  steepestDrop: ChannelRetentionDrop | null
  // The three best-retaining uploads and the three worst, each averaged into one
  // line. Null until six videos carry both a curve and a view count, because two
  // bands drawn from overlapping videos would compare a library with itself.
  bands: ChannelRetentionBands | null
}

// Viewer counts turned into weights, with no single video allowed more than
// `maxShare` of the total. Solved directly rather than by repeatedly clipping:
// capping the top k videos at c leaves a total of k*c plus the untouched rest,
// so c = maxShare * rest / (1 - k * maxShare) is the cap that makes each capped
// video land exactly on the limit. The smallest k whose cap already sits at or
// above the largest uncapped video is the answer.
//
// A limit too tight to be satisfiable (two videos cannot each stay under 40%)
// relaxes to an even split, which is the tightest cap such a library admits.
export function cappedViewWeights(
  views: readonly number[],
  maxShare: number = channelCurveMaxWeightShare(views.length),
): number[] {
  const count = views.length
  if (count === 0) return []
  const share = Math.min(1, Math.max(maxShare, 1 / count))

  const descending = [...views].sort((a, b) => b - a)
  let rest = descending.reduce((total, value) => total + value, 0)

  for (let k = 0; k < count; k++) {
    const denominator = 1 - k * share
    if (denominator <= 0) break
    const cap = (share * rest) / denominator
    if (descending[k] <= cap) {
      return views.map((value) => Math.min(value, cap))
    }
    rest -= descending[k]
  }

  // Only reachable when every video would need capping, which means the limit
  // forces one weight each.
  return views.map(() => 1)
}

// The share still watching at every grid position for one stored curve. Reuses
// the comparator's interpolation, so a curve read here and the same curve read
// on a head-to-head cannot disagree, including on the 0% = 100% baseline both
// prepend.
function resample(curve: RetentionPoint[], grid: readonly number[]): number[] {
  return grid.map((ratio) => watchRatioAt(curve, ratio) ?? 0)
}

// The share of its runtime an average viewer watched: the mean of the resampled
// curve, which is the area under it. The one number a whole curve can be ranked
// on, and the same quantity YouTube reports as average view percentage.
function watchedShare(watchRatios: readonly number[]): number {
  return (
    watchRatios.reduce((total, ratio) => total + ratio, 0) / watchRatios.length
  )
}

// What a band needs to know about each of its videos beyond the curve itself.
interface RetentionBandMember {
  id: string
  title: string | null
  views: number
}

// One band of videos averaged onto the shared grid, weighted by the viewers
// behind each of them under the same cap the library average uses.
function bandCurve(
  indices: readonly number[],
  series: readonly number[][],
  members: readonly RetentionBandMember[],
  shares: readonly number[],
): ChannelRetentionBand {
  const weights = cappedViewWeights(
    indices.map((index) => members[index].views),
  )
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  const watchRatios = series[indices[0]].map((_, gridIndex) =>
    indices.reduce(
      (total, videoIndex, bandIndex) =>
        total + weights[bandIndex] * series[videoIndex][gridIndex],
      0,
    ) / totalWeight,
  )
  return {
    videoCount: indices.length,
    totalViews: indices.reduce(
      (total, index) => total + members[index].views,
      0,
    ),
    watchRatios,
    watchedShare: watchedShare(watchRatios),
    videos: indices.map((index) => ({
      id: members[index].id,
      title: members[index].title,
      views: members[index].views,
      watchedShare: shares[index],
    })),
  }
}

// The two ends of the library, or null when there are too few videos for the
// bands to be full and disjoint.
function retentionBands(
  series: readonly number[][],
  members: readonly RetentionBandMember[],
): ChannelRetentionBands | null {
  if (series.length < RETENTION_BAND_MIN_VIDEOS) return null
  const shares = series.map(watchedShare)
  const ranked = series
    .map((_, index) => index)
    // Best-retaining first, ties broken on the id so the bands are stable
    // between renders rather than left to sort order.
    .sort(
      (a, b) =>
        shares[b] - shares[a] || members[a].id.localeCompare(members[b].id),
    )
  return {
    top: bandCurve(
      ranked.slice(0, RETENTION_BAND_SIZE),
      series,
      members,
      shares,
    ),
    // Kept in the same best-first order the ranking produced, so the worst
    // upload is the last row of the list rather than the first, exactly as the
    // other tabs print their bottom band.
    bottom: bandCurve(
      ranked.slice(-RETENTION_BAND_SIZE),
      series,
      members,
      shares,
    ),
  }
}

function steepestDrop(
  points: readonly ChannelRetentionCurvePoint[],
): ChannelRetentionDrop | null {
  const span = Math.max(1, Math.round(STEEPEST_DROP_SPAN * (points.length - 1)))
  let steepest: ChannelRetentionDrop | null = null
  for (let i = 0; i + span < points.length; i++) {
    const lost = points[i].watchRatio - points[i + span].watchRatio
    if (lost <= 0) continue
    if (steepest == null || lost > steepest.lost) {
      steepest = {
        fromRatio: points[i].elapsedRatio,
        toRatio: points[i + span].elapsedRatio,
        lost,
      }
    }
  }
  return steepest
}

// The library's average curve, or null when too few videos carry both a stored
// curve and the view count the weighting needs.
export function buildChannelRetentionCurve(
  videos: readonly ChannelRetentionVideoInput[],
): ChannelRetentionCurve | null {
  const withCurve = videos.flatMap((video) =>
    video.retention != null &&
    video.retention.length >= MIN_STORED_CURVE_POINTS
      ? [{ ...video, retention: video.retention }]
      : [],
  )
  const contributors = withCurve.flatMap((video) =>
    video.views != null && video.views > 0
      ? [{ ...video, views: video.views }]
      : [],
  )
  if (contributors.length < CHANNEL_CURVE_MIN_VIDEOS) return null

  const grid = Array.from(
    { length: CHANNEL_CURVE_GRID_POINTS },
    (_, index) => index / (CHANNEL_CURVE_GRID_POINTS - 1),
  )
  const series = contributors.map((video) => resample(video.retention, grid))
  const views = contributors.map((video) => video.views)
  const weights = cappedViewWeights(views)
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)

  const points: ChannelRetentionCurvePoint[] = grid.map(
    (elapsedRatio, gridIndex) => {
      const contributions: WeightedProportion[] = series.map(
        (watchRatios, videoIndex) => ({
          proportion: watchRatios[gridIndex],
          weight: weights[videoIndex],
          sampleSize: views[videoIndex],
        }),
      )
      return {
        elapsedRatio,
        watchRatio:
          contributions.reduce(
            (total, contribution) =>
              total + contribution.weight * contribution.proportion,
            0,
          ) / totalWeight,
        // Every curve starts at 100% by definition, so the average starts there
        // too and carries no sampling error at that one position.
        margin:
          gridIndex === 0 ? 0 : weightedProportionMarginOfError(contributions),
      }
    },
  )

  // Weighted over the videos that stored a runtime, so one row missing its
  // duration shortens the estimate rather than dragging it toward zero.
  let durationWeight = 0
  let weightedDuration = 0
  contributors.forEach((video, index) => {
    if (video.durationSeconds == null) return
    durationWeight += weights[index]
    weightedDuration += weights[index] * video.durationSeconds
  })
  const averageDurationSeconds =
    durationWeight > 0 ? weightedDuration / durationWeight : null

  const last = CHANNEL_CURVE_GRID_POINTS - 1
  return {
    points,
    videos: contributors.map((video, index) => ({
      id: video.id,
      title: video.title,
      views: video.views,
      weightShare: weights[index] / totalWeight,
      watchRatios: series[index],
    })),
    videoCount: contributors.length,
    totalViews: views.reduce((total, value) => total + value, 0),
    unweightedVideoCount: withCurve.length - contributors.length,
    averageDurationSeconds,
    holdAtQuarter: points[Math.round(last * 0.25)].watchRatio,
    holdAtHalf: points[Math.round(last * 0.5)].watchRatio,
    holdAtEnd: points[last].watchRatio,
    steepestDrop: steepestDrop(points),
    bands: retentionBands(
      series,
      contributors.map((video) => ({
        id: video.id,
        title: video.title,
        views: video.views,
      })),
    ),
  }
}
