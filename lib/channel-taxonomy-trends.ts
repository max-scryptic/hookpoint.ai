// Channel-level aggregation over the two per-video taxonomies: the packaging
// read (lib/packaging-taxonomy.ts) and the script read (lib/script-taxonomy.ts).
// Both score every video on the SAME closed vocabularies and the same 0-10
// axes, each video judged in isolation, which is exactly what makes them
// summable across a library. lib/channel-trends.ts already contrasts the flat
// v1 packaging flags between reach bands; this module does the two things that
// vocabulary cannot do:
//
//   axis profile   the 0-10 ordinals, as a channel median per axis plus the
//                  gap between the top and bottom half of the library on some
//                  outcome ("your high-reach titles score 7 on specificity,
//                  your low-reach ones score 3")
//   style profile  the categorical enums, as a distribution per dimension plus
//                  each category's median outcome ("6 of your 9 uploads are
//                  warnings; the 2 tutorials reach twice as far")
//
// Two outcomes are supported and both come off the stored analytics snapshot:
// REACH (views per day since publish, the packaging outcome) and RETENTION
// (average view percentage, the script outcome). Everything here is
// correlational by construction and the page says so: a library is a handful of
// videos, and the same creator made all of them.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in this
// file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.test.ts.

import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"

export type TaxonomySource = "packaging" | "script"

// Which stored metric the top/bottom split is made on. Reach answers "what got
// clicked", retention answers "what got watched".
export type ChannelOutcome = "reach" | "retention"

// The minimum any of this needs: a video with at least one taxonomy attached.
export interface TaxonomyProfileVideo {
  id: string
  title: string | null
  packaging: PackagingTaxonomy | null
  script: ScriptTaxonomy | null
}

// A profile needs a few videos before a median means anything, and each half of
// the split needs at least a pair before their difference does.
export const TAXONOMY_PROFILE_MIN_VIDEOS = 3
const CONTRAST_MIN_VIDEOS = 4
const CONTRAST_MIN_BAND_VIDEOS = 2
// On a 0-10 scale scored per video in isolation, anything under this is inside
// the noise of one model call and is not worth a sentence.
const AXIS_MIN_DELTA = 1.5
const MAX_AXIS_CONTRASTS = 5
// A category needs a couple of videos and a pronounced outcome ratio before the
// page reports how it performed.
const CATEGORY_MIN_OUTCOME_VIDEOS = 2
const CATEGORY_CALLOUT_RATIO = 1.4
const MAX_CATEGORY_ROWS = 4

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

// One decimal, because a mean across a handful of videos lands between the
// integers a single video is always scored on.
function mean(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 10) / 10
}

// --- axis definitions --------------------------------------------------------

// Groups exist so the profile can be read surface by surface rather than as one
// undifferentiated list of numbers. Order here is the order they render.
export const PACKAGING_AXIS_GROUPS = [
  "title",
  "thumbnail",
  "opening",
  "alignment",
] as const
export type PackagingAxisGroup = (typeof PACKAGING_AXIS_GROUPS)[number]

export const SCRIPT_AXIS_GROUPS = [
  "substance",
  "structure",
  "emotion",
  "rhetoric",
] as const
export type ScriptAxisGroup = (typeof SCRIPT_AXIS_GROUPS)[number]

export type TaxonomyAxisGroup = PackagingAxisGroup | ScriptAxisGroup

interface AxisDefinition<T> {
  key: string
  group: TaxonomyAxisGroup
  // True for axes where neither end is better (visual complexity, where the
  // payoff sits): the score says what kind of video this is, not how well it
  // was made. The page draws them like any other axis and leaves the reading to
  // the reader; the flag is here so that judgement stays recorded next to the
  // axis rather than in someone's head.
  descriptor?: boolean
  read: (taxonomy: T) => number | null
}

// Only the axes a creator can act on. The verbatim spans, the free-text fields
// and the character count are per-video detail, not channel signal, so they are
// deliberately absent.
const PACKAGING_AXES: AxisDefinition<PackagingTaxonomy>[] = [
  { key: "title.specificity", group: "title", read: (t) => t.detail?.title.specificity ?? null },
  { key: "title.curiosityGap", group: "title", read: (t) => t.detail?.title.curiosityGap ?? null },
  { key: "title.emotionalCharge", group: "title", read: (t) => t.detail?.title.emotionalCharge ?? null },
  { key: "title.stakes", group: "title", read: (t) => t.detail?.title.stakes ?? null },
  { key: "title.relatability", group: "title", read: (t) => t.detail?.title.relatability ?? null },
  { key: "title.novelty", group: "title", read: (t) => t.detail?.title.novelty ?? null },
  { key: "title.clarity", group: "title", read: (t) => t.detail?.title.clarity ?? null },
  { key: "thumbnail.faceProminence", group: "thumbnail", read: (t) => t.detail?.thumbnail.faceProminence ?? null },
  { key: "thumbnail.emotionIntensity", group: "thumbnail", read: (t) => t.detail?.thumbnail.emotionIntensity ?? null },
  { key: "thumbnail.colorContrast", group: "thumbnail", read: (t) => t.detail?.thumbnail.colorContrast ?? null },
  {
    key: "thumbnail.visualComplexity",
    group: "thumbnail",
    descriptor: true,
    read: (t) => t.detail?.thumbnail.visualComplexity ?? null,
  },
  { key: "hook.payoffSpeed", group: "opening", read: (t) => t.detail?.hook.payoffSpeed ?? null },
  { key: "hook.restatesPromise", group: "opening", read: (t) => t.detail?.hook.restatesPromise ?? null },
  { key: "hook.stakesEstablished", group: "opening", read: (t) => t.detail?.hook.stakesEstablished ?? null },
  { key: "hook.specificity", group: "opening", read: (t) => t.detail?.hook.specificity ?? null },
  { key: "hook.personalDisclosure", group: "opening", descriptor: true, read: (t) => t.detail?.hook.personalDisclosure ?? null },
  { key: "cross.titleThumbnailMatch", group: "alignment", read: (t) => t.detail?.cross.titleThumbnailMatch ?? null },
  { key: "cross.hookDeliversPromise", group: "alignment", read: (t) => t.detail?.cross.hookDeliversPromise ?? null },
]

const SCRIPT_AXES: AxisDefinition<ScriptTaxonomy>[] = [
  { key: "substance.substanceDensity", group: "substance", read: (t) => t.detail?.substance.substanceDensity ?? null },
  { key: "substance.concreteness", group: "substance", read: (t) => t.detail?.substance.concreteness ?? null },
  { key: "substance.noveltyOfIdeas", group: "substance", read: (t) => t.detail?.substance.noveltyOfIdeas ?? null },
  { key: "substance.educationalValue", group: "substance", descriptor: true, read: (t) => t.detail?.substance.educationalValue ?? null },
  { key: "substance.entertainmentValue", group: "substance", descriptor: true, read: (t) => t.detail?.substance.entertainmentValue ?? null },
  { key: "substance.fillerLevel", group: "substance", read: (t) => t.detail?.substance.fillerLevel ?? null },
  { key: "structure.topicCohesion", group: "structure", descriptor: true, read: (t) => t.detail?.structure.topicCohesion ?? null },
  { key: "structure.openLoops", group: "structure", read: (t) => t.detail?.structure.openLoops ?? null },
  { key: "structure.payoffPlacement", group: "structure", descriptor: true, read: (t) => t.detail?.structure.payoffPlacement ?? null },
  { key: "emotion.energy", group: "emotion", read: (t) => t.detail?.emotion.energy ?? null },
  { key: "emotion.emotionalRange", group: "emotion", read: (t) => t.detail?.emotion.emotionalRange ?? null },
  { key: "emotion.vulnerability", group: "emotion", descriptor: true, read: (t) => t.detail?.emotion.vulnerability ?? null },
  { key: "humor.humorDensity", group: "emotion", descriptor: true, read: (t) => t.detail?.humor.humorDensity ?? null },
  { key: "rhetoric.directAddress", group: "rhetoric", read: (t) => t.detail?.rhetoric.directAddress ?? null },
  { key: "rhetoric.stakes", group: "rhetoric", read: (t) => t.detail?.rhetoric.stakes ?? null },
  { key: "rhetoric.relatability", group: "rhetoric", read: (t) => t.detail?.rhetoric.relatability ?? null },
]

// A higher number is better on most axes, but fillerLevel is the one axis where
// less is more, so a contrast on it has to be read the other way round.
const LOWER_IS_BETTER = new Set(["substance.fillerLevel"])

export function axisIsDescriptor(key: string): boolean {
  return (
    PACKAGING_AXES.some((axis) => axis.key === key && axis.descriptor === true) ||
    SCRIPT_AXES.some((axis) => axis.key === key && axis.descriptor === true)
  )
}

export function axisLowerIsBetter(key: string): boolean {
  return LOWER_IS_BETTER.has(key)
}

// --- axis profile ------------------------------------------------------------

export interface ChannelAxisRow {
  key: string
  group: TaxonomyAxisGroup
  // Median across every taxonomy-carrying video, on the 0-10 scale.
  channelMedian: number
  videoCount: number
  // Medians of the top and bottom half on the profile's outcome; null when the
  // library is too small to split.
  topMedian: number | null
  bottomMedian: number | null
  // topMedian - bottomMedian, so a positive number means the better-performing
  // half scores higher on this axis. Null when there was no split.
  delta: number | null
}

export interface ChannelAxisProfile {
  source: TaxonomySource
  outcome: ChannelOutcome
  // Every axis with at least one reading, in definition order.
  axes: ChannelAxisRow[]
  // The axes whose two halves genuinely separate, biggest gap first. Empty when
  // the library is too small to split or nothing separated.
  contrasts: ChannelAxisRow[]
  taxonomyVideoCount: number
  // Videos in the two bands combined (2 x bandSize), 0 when there was no split.
  contrastVideoCount: number
  bandSize: number
}

function axisRows<T>(
  definitions: AxisDefinition<T>[],
  all: T[],
  top: T[],
  bottom: T[],
  splitAvailable: boolean,
): ChannelAxisRow[] {
  return definitions.flatMap((axis) => {
    const values = all.flatMap((taxonomy) => {
      const value = axis.read(taxonomy)
      return value == null ? [] : [value]
    })
    if (values.length === 0) return []

    const bandMedian = (band: T[]): number | null => {
      const bandValues = band.flatMap((taxonomy) => {
        const value = axis.read(taxonomy)
        return value == null ? [] : [value]
      })
      return bandValues.length === 0 ? null : median(bandValues)
    }
    const topMedian = splitAvailable ? bandMedian(top) : null
    const bottomMedian = splitAvailable ? bandMedian(bottom) : null
    return [
      {
        key: axis.key,
        group: axis.group,
        channelMedian: median(values),
        videoCount: values.length,
        topMedian,
        bottomMedian,
        delta:
          topMedian == null || bottomMedian == null
            ? null
            : topMedian - bottomMedian,
      },
    ]
  })
}

// The channel's own 0-10 profile on one taxonomy, plus the axes that separate
// its best and worst performers on the given outcome. Videos with no outcome
// still contribute to the channel medians; only the split needs the metric.
export function buildChannelAxisProfile<V extends TaxonomyProfileVideo>(params: {
  videos: V[]
  source: TaxonomySource
  outcome: ChannelOutcome
  outcomeOf: (video: V) => number | null
}): ChannelAxisProfile | null {
  const { videos, source, outcome, outcomeOf } = params
  const taxonomyOf = (video: V): PackagingTaxonomy | ScriptTaxonomy | null =>
    source === "packaging" ? video.packaging : video.script

  const carrying = videos.flatMap((video) => {
    const taxonomy = taxonomyOf(video)
    // A v1 packaging row has no `detail`, so it carries no axes at all.
    if (taxonomy == null || taxonomy.detail == null) return []
    return [{ video, taxonomy }]
  })
  if (carrying.length < TAXONOMY_PROFILE_MIN_VIDEOS) return null

  const withOutcome = carrying.flatMap((entry) => {
    const value = outcomeOf(entry.video)
    return value == null ? [] : [{ ...entry, outcome: value }]
  })
  withOutcome.sort(
    (a, b) => b.outcome - a.outcome || a.video.id.localeCompare(b.video.id),
  )
  const bandSize =
    withOutcome.length >= CONTRAST_MIN_VIDEOS
      ? Math.floor(withOutcome.length / 2)
      : 0
  const splitAvailable = bandSize >= CONTRAST_MIN_BAND_VIDEOS
  const top = splitAvailable ? withOutcome.slice(0, bandSize) : []
  const bottom = splitAvailable ? withOutcome.slice(-bandSize) : []

  // The axis readers are typed to one taxonomy each, and `carrying` is already
  // narrowed to the source's own rows, so the cast is over a union the caller
  // cannot get wrong.
  const definitions = (
    source === "packaging" ? PACKAGING_AXES : SCRIPT_AXES
  ) as AxisDefinition<PackagingTaxonomy | ScriptTaxonomy>[]

  const axes = axisRows(
    definitions,
    carrying.map((entry) => entry.taxonomy),
    top.map((entry) => entry.taxonomy),
    bottom.map((entry) => entry.taxonomy),
    splitAvailable,
  )
  if (axes.length === 0) return null

  const contrasts = axes
    .filter((row) => row.delta != null && Math.abs(row.delta) >= AXIS_MIN_DELTA)
    .sort(
      (a, b) =>
        Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, MAX_AXIS_CONTRASTS)

  return {
    source,
    outcome,
    axes,
    contrasts,
    taxonomyVideoCount: carrying.length,
    contrastVideoCount: splitAvailable ? bandSize * 2 : 0,
    bandSize: splitAvailable ? bandSize : 0,
  }
}

// --- the extremes: the best few uploads against the worst few ----------------

// The halves split above answers "what does my better half do"; this answers
// the blunter question a creator actually asks first: what did my three
// biggest hits have that my three flops did not. Same axes, same per-video
// scores, but only the ends of the ranking, which is what makes it drawable as
// a shape rather than a list of bars.
export const EXTREMES_BAND_SIZE = 3
// Both bands have to be full and disjoint before the comparison means
// anything, so the ranking needs at least two full bands.
export const EXTREMES_MIN_VIDEOS = EXTREMES_BAND_SIZE * 2
const MAX_EXTREME_CONTRASTS = 3

export interface ChannelExtremeVideo {
  id: string
  title: string | null
  // The metric the ranking was made on: views per day for reach, average view
  // percentage for retention.
  outcome: number
}

export interface ChannelExtremeAxisRow {
  key: string
  group: TaxonomyAxisGroup
  // Band means on the 0-10 scale. A mean rather than a median because three
  // videos is too few for a median to say anything the mean does not.
  topMean: number
  bottomMean: number
  // The same mean over every read video, ranked or not: the baseline the two
  // bands are read against, so "the winners score high here" can be told apart
  // from "this channel scores high here".
  libraryMean: number
  // topMean - bottomMean, so positive means the winners score higher here.
  delta: number
}

export interface ChannelExtremeGroup {
  group: TaxonomyAxisGroup
  axes: ChannelExtremeAxisRow[]
}

export interface ChannelExtremesProfile {
  source: TaxonomySource
  outcome: ChannelOutcome
  bandSize: number
  // Best first in both bands, so the two lists read in the same direction.
  top: ChannelExtremeVideo[]
  bottom: ChannelExtremeVideo[]
  // Every axis both bands could be scored on, grouped by surface in definition
  // order, so each group can be drawn as one shape.
  groups: ChannelExtremeGroup[]
  // The axes where the two bands separate most, biggest gap first. Empty when
  // the ends of the library score alike.
  contrasts: ChannelExtremeAxisRow[]
  // Videos carrying both a taxonomy and the metric, so the page can say what
  // the two bands were picked out of.
  rankedVideoCount: number
  // Videos behind the library average, which needs a read but not the metric,
  // so it is never smaller than rankedVideoCount and is usually larger.
  libraryVideoCount: number
}

// The two ends of the library on one taxonomy: which videos they are, what each
// band averages on every axis, and where the library as a whole sits. Videos
// missing the outcome metric cannot be ranked, so they are absent from the two
// bands, but they still carry a read and so still count toward the average.
export function buildChannelExtremesProfile<
  V extends TaxonomyProfileVideo,
>(params: {
  videos: V[]
  source: TaxonomySource
  outcome: ChannelOutcome
  outcomeOf: (video: V) => number | null
}): ChannelExtremesProfile | null {
  const { videos, source, outcome, outcomeOf } = params

  const carrying = videos.flatMap((video) => {
    const taxonomy = source === "packaging" ? video.packaging : video.script
    // A v1 packaging row has no `detail`, so it carries no axes at all.
    if (taxonomy == null || taxonomy.detail == null) return []
    return [{ video, taxonomy, outcome: outcomeOf(video) }]
  })
  const ranked = carrying.flatMap((entry) =>
    entry.outcome == null ? [] : [{ ...entry, outcome: entry.outcome }],
  )
  if (ranked.length < EXTREMES_MIN_VIDEOS) return null

  ranked.sort(
    (a, b) => b.outcome - a.outcome || a.video.id.localeCompare(b.video.id),
  )
  const top = ranked.slice(0, EXTREMES_BAND_SIZE)
  const bottom = ranked.slice(-EXTREMES_BAND_SIZE)

  // Same cast as the profile above: `ranked` is already narrowed to the
  // source's own rows, so the union the readers see cannot be the wrong one.
  const definitions = (
    source === "packaging" ? PACKAGING_AXES : SCRIPT_AXES
  ) as AxisDefinition<PackagingTaxonomy | ScriptTaxonomy>[]

  const bandMean = (
    band: { taxonomy: PackagingTaxonomy | ScriptTaxonomy }[],
    axis: AxisDefinition<PackagingTaxonomy | ScriptTaxonomy>,
  ): number | null => {
    const values = band.flatMap((entry) => axis.read(entry.taxonomy) ?? [])
    return values.length === 0 ? null : mean(values)
  }

  // An axis only survives when both bands could be scored on it: half a
  // comparison would draw a shape with a hole in it. The library average is
  // taken over a superset of the bands, so it is there whenever they are.
  const rows = definitions.flatMap((axis): ChannelExtremeAxisRow[] => {
    const topMean = bandMean(top, axis)
    const bottomMean = bandMean(bottom, axis)
    const libraryMean = bandMean(carrying, axis)
    if (topMean == null || bottomMean == null || libraryMean == null) return []
    return [
      {
        key: axis.key,
        group: axis.group,
        topMean,
        bottomMean,
        libraryMean,
        delta: Math.round((topMean - bottomMean) * 10) / 10,
      },
    ]
  })
  if (rows.length === 0) return null

  const asVideo = (entry: (typeof ranked)[number]): ChannelExtremeVideo => ({
    id: entry.video.id,
    title: entry.video.title,
    outcome: entry.outcome,
  })

  return {
    source,
    outcome,
    bandSize: EXTREMES_BAND_SIZE,
    top: top.map(asVideo),
    bottom: bottom.map(asVideo),
    groups: [...new Set(rows.map((row) => row.group))].map((group) => ({
      group,
      axes: rows.filter((row) => row.group === group),
    })),
    contrasts: rows
      .filter((row) => Math.abs(row.delta) >= AXIS_MIN_DELTA)
      .sort(
        (a, b) =>
          Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key),
      )
      .slice(0, MAX_EXTREME_CONTRASTS),
    rankedVideoCount: ranked.length,
    libraryVideoCount: carrying.length,
  }
}

// --- reading one surface out of a profile ------------------------------------

// The Packaging tab reads its profiles one surface at a time, because it splits
// into a Hook, Title, Thumbnail and Alignment sub-tab and each of those is only
// ever about its own axes. Both profiles above cap their contrast lists across
// every group at once, so a surface cannot simply filter that list: it would
// report "nothing separated" whenever noisier surfaces happened to fill the cap.
// These re-derive the same rule per group instead, uncapped, because one
// surface carries a handful of axes rather than the whole taxonomy.

export function axisGroupRows(
  profile: ChannelAxisProfile,
  group: TaxonomyAxisGroup,
): ChannelAxisRow[] {
  return profile.axes.filter((row) => row.group === group)
}

export function axisGroupContrasts(
  profile: ChannelAxisProfile,
  group: TaxonomyAxisGroup,
): ChannelAxisRow[] {
  return axisGroupRows(profile, group)
    .filter((row) => row.delta != null && Math.abs(row.delta) >= AXIS_MIN_DELTA)
    .sort(
      (a, b) =>
        Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
        a.key.localeCompare(b.key),
    )
}

export function extremeGroupAxes(
  profile: ChannelExtremesProfile,
  group: TaxonomyAxisGroup,
): ChannelExtremeAxisRow[] {
  return profile.groups.find((entry) => entry.group === group)?.axes ?? []
}

export function extremeGroupContrasts(
  profile: ChannelExtremesProfile,
  group: TaxonomyAxisGroup,
): ChannelExtremeAxisRow[] {
  return extremeGroupAxes(profile, group)
    .filter((row) => Math.abs(row.delta) >= AXIS_MIN_DELTA)
    .sort(
      (a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key),
    )
}

// --- alignment average -------------------------------------------------------

// Which of the two cross axes a part row carries, so the page can name it with
// the same words a single video's report uses
// (components/packaging-alignment-score.tsx).
export type AlignmentPartKey = "titleThumbnailMatch" | "hookDeliversPromise"

export interface ChannelAlignmentPart {
  key: AlignmentPartKey
  value: number
}

export interface ChannelAlignmentAverage {
  // The mean of every read video's alignment score, on the same 0-10 scale a
  // single video's report prints it on.
  score: number
  // The same mean over the two axes the headline is made of, in reading order.
  // Empty when no video carries an enriched (v2) packaging read.
  parts: ChannelAlignmentPart[]
  // Videos behind the headline: every one carrying a packaging read at all.
  videoCount: number
  // Videos behind the parts, which a v1 row cannot contribute to. 0 when the
  // parts are empty.
  partVideoCount: number
}

const ALIGNMENT_PART_AXES: {
  key: AlignmentPartKey
  read: (taxonomy: PackagingTaxonomy) => number | null
}[] = [
  {
    key: "titleThumbnailMatch",
    read: (t) => t.detail?.cross.titleThumbnailMatch ?? null,
  },
  {
    key: "hookDeliversPromise",
    read: (t) => t.detail?.cross.hookDeliversPromise ?? null,
  },
]

// The channel's alignment headline: how tightly its packaging promises one
// thing, averaged over every analysed video carrying a packaging read.
//
// A mean rather than the medians the rest of this file reports, because this is
// the one number a creator watches move as they publish, and a median over a
// small library sits still while the work changes. Every video is scored on its
// own at analysis time, so the average describes the library rather than
// ranking anything inside it.
export function buildChannelAlignmentAverage(
  videos: TaxonomyProfileVideo[],
): ChannelAlignmentAverage | null {
  const taxonomies = videos.flatMap((video) => video.packaging ?? [])
  if (taxonomies.length < TAXONOMY_PROFILE_MIN_VIDEOS) return null

  const parts = ALIGNMENT_PART_AXES.flatMap((axis) => {
    const values = taxonomies.flatMap((taxonomy) => axis.read(taxonomy) ?? [])
    return values.length === 0
      ? []
      : [{ key: axis.key, value: mean(values) }]
  })

  return {
    // Stored 0..1, printed 0-10, exactly as one video's readout scales it.
    score: mean(taxonomies.map((taxonomy) => taxonomy.alignmentScore * 10)),
    parts,
    videoCount: taxonomies.length,
    partVideoCount:
      parts.length === 0
        ? 0
        : taxonomies.filter((taxonomy) => taxonomy.detail != null).length,
  }
}

// --- style profile -----------------------------------------------------------

interface DimensionDefinition<T> {
  key: string
  // Every category this video belongs to on this dimension. Most return one
  // value; title styles return the one or two the title leans on.
  read: (taxonomy: T) => string[]
}

const PACKAGING_DIMENSIONS: DimensionDefinition<PackagingTaxonomy>[] = [
  {
    key: "packaging.archetype",
    read: (t) => (t.detail ? [t.detail.drivers.archetype] : []),
  },
  {
    key: "packaging.primaryDriver",
    read: (t) => (t.detail ? [t.detail.drivers.primaryDriver] : []),
  },
  { key: "packaging.titleStyle", read: (t) => t.titleStyles },
  {
    key: "packaging.openingType",
    read: (t) => (t.detail ? [t.detail.hook.openingType] : []),
  },
  {
    key: "packaging.thumbnailMood",
    read: (t) => (t.detail ? [t.detail.thumbnail.mood] : []),
  },
]

const SCRIPT_DIMENSIONS: DimensionDefinition<ScriptTaxonomy>[] = [
  { key: "script.format", read: (t) => [t.format] },
  {
    key: "script.archetype",
    read: (t) => (t.detail ? [t.detail.drivers.scriptArchetype] : []),
  },
  {
    key: "script.dominantEmotion",
    read: (t) => (t.detail ? [t.detail.emotion.dominantEmotion] : []),
  },
  {
    key: "script.arcShape",
    read: (t) => (t.detail ? [t.detail.emotion.arcShape] : []),
  },
  {
    key: "script.engagementDriver",
    read: (t) => (t.detail ? [t.detail.drivers.primaryEngagementDriver] : []),
  },
]

export interface ChannelCategoryRow {
  value: string
  videoCount: number
  // Of the videos carrying this dimension at all.
  share: number
  // Median outcome among this category's videos; null when too few carry one.
  medianOutcome: number | null
  // That median against the channel's, so 2 means twice the typical outcome.
  // Null when the channel median is zero or the category is too small.
  outcomeRatio: number | null
}

export interface ChannelStyleDimension {
  key: string
  // Videos carrying a value on this dimension.
  videoCount: number
  // Most common first, capped; a long tail is folded away rather than listed.
  rows: ChannelCategoryRow[]
  // How many categories were dropped off the end of `rows`.
  hiddenCategoryCount: number
  // The category whose outcome most exceeds the channel's, when one is
  // pronounced enough to name and is not simply the dominant category.
  standout: ChannelCategoryRow | null
}

export interface ChannelStyleProfile {
  source: TaxonomySource
  outcome: ChannelOutcome
  dimensions: ChannelStyleDimension[]
  taxonomyVideoCount: number
  // Videos with both a taxonomy and the outcome metric, so the page can say
  // what the ratios are measured over.
  outcomeVideoCount: number
}

// The channel's categorical fingerprint on one taxonomy: what it repeats, and
// which of the categories it uses performs unusually well or badly.
export function buildChannelStyleProfile<V extends TaxonomyProfileVideo>(params: {
  videos: V[]
  source: TaxonomySource
  outcome: ChannelOutcome
  outcomeOf: (video: V) => number | null
}): ChannelStyleProfile | null {
  const { videos, source, outcome, outcomeOf } = params
  const carrying = videos.flatMap((video) => {
    const taxonomy = source === "packaging" ? video.packaging : video.script
    return taxonomy == null ? [] : [{ video, taxonomy }]
  })
  if (carrying.length < TAXONOMY_PROFILE_MIN_VIDEOS) return null

  const outcomes = carrying.flatMap((entry) => {
    const value = outcomeOf(entry.video)
    return value == null ? [] : [value]
  })
  const channelMedian = outcomes.length > 0 ? median(outcomes) : null

  const definitions = (
    source === "packaging" ? PACKAGING_DIMENSIONS : SCRIPT_DIMENSIONS
  ) as DimensionDefinition<PackagingTaxonomy | ScriptTaxonomy>[]

  const dimensions = definitions.flatMap(
    (dimension): ChannelStyleDimension[] => {
      const byValue = new Map<string, { videos: Set<string>; outcomes: number[] }>()
      let dimensionVideoCount = 0
      for (const entry of carrying) {
        const values = [...new Set(dimension.read(entry.taxonomy))]
        if (values.length === 0) continue
        dimensionVideoCount += 1
        const entryOutcome = outcomeOf(entry.video)
        for (const value of values) {
          const stats =
            byValue.get(value) ?? { videos: new Set<string>(), outcomes: [] }
          stats.videos.add(entry.video.id)
          if (entryOutcome != null) stats.outcomes.push(entryOutcome)
          byValue.set(value, stats)
        }
      }
      if (dimensionVideoCount === 0) return []

      const allRows: ChannelCategoryRow[] = [...byValue.entries()]
        .map(([value, stats]) => {
          const categoryMedian =
            stats.outcomes.length >= CATEGORY_MIN_OUTCOME_VIDEOS
              ? median(stats.outcomes)
              : null
          return {
            value,
            videoCount: stats.videos.size,
            share: stats.videos.size / dimensionVideoCount,
            medianOutcome: categoryMedian,
            outcomeRatio:
              categoryMedian == null ||
              channelMedian == null ||
              channelMedian <= 0
                ? null
                : categoryMedian / channelMedian,
          }
        })
        .sort(
          (a, b) => b.videoCount - a.videoCount || a.value.localeCompare(b.value),
        )

      const rows = allRows.slice(0, MAX_CATEGORY_ROWS)
      const dominant = allRows[0]
      const standout =
        allRows
          .filter(
            (row) =>
              row.value !== dominant.value &&
              row.outcomeRatio != null &&
              row.outcomeRatio >= CATEGORY_CALLOUT_RATIO,
          )
          .sort((a, b) => (b.outcomeRatio ?? 0) - (a.outcomeRatio ?? 0))[0] ??
        null

      return [
        {
          key: dimension.key,
          videoCount: dimensionVideoCount,
          rows,
          hiddenCategoryCount: allRows.length - rows.length,
          standout,
        },
      ]
    },
  )
  if (dimensions.length === 0) return null

  return {
    source,
    outcome,
    dimensions,
    taxonomyVideoCount: carrying.length,
    outcomeVideoCount: outcomes.length,
  }
}

// --- topic reach across both taxonomies -------------------------------------

// Both taxonomies tag a video with 1-3 lowercase topics, drawn from the same
// instruction, so the union is a better subject map than either alone.
export function videoTopics(video: TaxonomyProfileVideo): string[] {
  return [
    ...new Set([
      ...(video.packaging?.topics ?? []),
      ...(video.script?.topics ?? []),
    ]),
  ]
}
