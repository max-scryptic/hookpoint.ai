// Data for the Channel Trends page (app/dashboard/channel-trends): the size
// of the user's accumulated cross-video event library plus per-kind trend
// aggregations. Built over the same channel event records the synthesizer's
// channelHistory summary uses (lib/channel-event-history.ts), but richer —
// trends carry contributing video titles and example narratives so the page
// can show its evidence — and the library's size drives the progressive
// unlock stages the page renders.
//
// Beyond the per-kind tallies, this module scores how RELEVANT each pattern
// is, because raw frequency ranks the noisy event types first (scene cuts
// appear everywhere on a cut-heavy channel, in drops and gains alike). Three
// signals — all already stored per event — separate signal from style:
//   breadth     recurrence across distinct videos, not raw event volume
//   confidence  the synthesizer's own 0..1 "plausibly moved retention" score
//   contrast    how lopsided the type is between drop-off and gain windows
// They feed three derived views: the signature (per-type drop-vs-gain
// shares), the insights (the few patterns confident enough to phrase as
// feedback), and the recurrence strip (per-type presence across the most
// recent videos, so improvement is visible).

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  loadChannelEventRecords,
  type ChannelEventRecord,
} from "@/lib/channel-event-history"
import {
  buildChannelAlignmentAverage,
  buildChannelAxisProfile,
  buildChannelExtremesProfile,
  buildChannelStyleProfile,
  videoTopics,
  type ChannelAlignmentAverage,
  type ChannelAxisProfile,
  type ChannelExtremesProfile,
  type ChannelStyleProfile,
} from "@/lib/channel-taxonomy-trends"
import type {
  HookDelivery,
  PackagingTaxonomy,
  PromiseType,
  TitleStyle,
} from "@/lib/packaging-taxonomy"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"
import type { RetentionWindowKind } from "@/lib/retention-windows"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"

// Trend confidence grows with library size: below EARLY the page only shows
// the library filling up; from EARLY trends appear labelled as early signals;
// from ESTABLISHED they're presented at full strength. EARLY deliberately sits
// just above the synthesizer's own two-video minimum — a pattern needs a few
// videos before a page dedicated to it reads as credible.
export const EARLY_TRENDS_VIDEO_THRESHOLD = 3
export const ESTABLISHED_TRENDS_VIDEO_THRESHOLD = 10

export type ChannelTrendsStage = "empty" | "building" | "early" | "established"

export function channelTrendsStage(
  libraryVideoCount: number,
): ChannelTrendsStage {
  if (libraryVideoCount <= 0) return "empty"
  if (libraryVideoCount < EARLY_TRENDS_VIDEO_THRESHOLD) return "building"
  if (libraryVideoCount < ESTABLISHED_TRENDS_VIDEO_THRESHOLD) return "early"
  return "established"
}

// Enough individual occurrences to fill an expanded drill-down without
// unbounded rows for a prolific channel's most common event type.
const MAX_TREND_EVENTS = 25
// Deeper than the synthesizer's prompt-summary cap: the page reports
// library-wide counts, so it reads further back before aggregating.
const MAX_EVENT_ROWS = 2000

// One occurrence of an event type, surfaced when a trend row is expanded so
// the page can show the events behind the count, ranked by confidence.
export interface ChannelTrendEvent {
  narrative: string
  videoTitle: string | null
  confidence: number | null
}

export interface ChannelTrend {
  eventType: RetentionWindowEventType
  eventCount: number
  // Distinct videos this event type appeared in for this window kind —
  // recurrence across videos, not raw volume, is what makes a channel trend.
  videoCount: number
  // The individual occurrences behind eventCount, highest-confidence first,
  // each attributed to its source video — the drill-down under the row. Capped
  // at MAX_TREND_EVENTS, so eventCount can exceed events.length.
  events: ChannelTrendEvent[]
}

export interface ChannelKindTrends {
  eventCount: number
  // Ordered by videoCount desc, then eventCount desc — most channel-wide first.
  trends: ChannelTrend[]
}

// A library video, as the derived views need it: title for attribution,
// analysis date to order the recurrence strip's columns, the lifetime totals
// from the analytics snapshot stored at analyse time (null when the video
// predates the analytics_summary column or a metric wasn't reported), and the
// packaging read for the packaging patterns view.
export interface ChannelVideo {
  id: string
  title: string | null
  dateAnalysed: string | null
  views: number | null
  subscribersGained: number | null
  subscribersLost: number | null
  // YouTube publish date, from the stored video metadata.
  publishedAt: string | null
  // When the analytics snapshot was taken — the "as of" moment views/day is
  // measured against, so a snapshot's age never skews the rate.
  analyticsFetchedAt: string | null
  // Share (0..1) of snapshot views from Browse features + Suggested videos —
  // the packaging-earned surfaces; null when no traffic breakdown exists.
  browseSuggestedShare: number | null
  // 0..100 — the average share of the video watched, from the same snapshot.
  // The retention outcome the script taxonomy is contrasted against.
  averageViewPercentage: number | null
  // 0..1 impression-weighted thumbnail click-through, when YouTube's reporting
  // job has served it for this video; null far more often than not.
  impressionClickThroughRate: number | null
  // The categorical packaging read; null until generated or backfilled.
  packaging: PackagingTaxonomy | null
  // The categorical read of the whole spoken script; null until generated.
  script: ScriptTaxonomy | null
}

// Reach for one video: views per day between publish and the analytics
// snapshot, floored at a day. Raw views cannot be compared across a library
// where one upload is two years old and another is two weeks old, so every
// reach comparison on this page runs over this rate. Null when the video is
// missing either end of the measurement.
export function videoReachPerDay(video: ChannelVideo): number | null {
  if (video.views == null || video.views <= 0) return null
  const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN
  const fetched = video.analyticsFetchedAt
    ? Date.parse(video.analyticsFetchedAt)
    : NaN
  if (!Number.isFinite(published) || !Number.isFinite(fetched)) return null
  return video.views / Math.max(1, Math.round((fetched - published) / DAY_MS))
}

const DAY_MS = 86_400_000

// Events with no confidence (rows written before the column existed) weigh in
// as a neutral 0.5 rather than being dropped or counted as certain.
const CONFIDENCE_FALLBACK = 0.5

// --- Signature: where each event type sits between drops and gains ---------

// A verdict needs a few distinct videos behind it before the page may call a
// pattern anything; below that the row renders without a judgement.
const VERDICT_MIN_VIDEOS = 3
// A type is "hurting"/"working" when at least this fraction of its weighted
// presence sits on one side; anything in between is just how the channel is
// edited.
const VERDICT_LOPSIDED_RATIO = 0.65

export type SignatureVerdict = "hurting" | "working" | "style" | "insufficient"

export interface ChannelSignatureRow {
  eventType: RetentionWindowEventType
  // Confidence-weighted share of each side's events (0..1): what fraction of
  // everything that happened in drop-offs / gains this type accounts for.
  dropShare: number
  gainShare: number
  dropEventCount: number
  gainEventCount: number
  dropVideoCount: number
  gainVideoCount: number
  // Distinct videos across both sides — what the verdict's evidence bar is
  // measured against.
  videoCount: number
  verdict: SignatureVerdict
}

// --- Insights: the patterns confident enough to phrase as feedback ---------

// The gates a pattern must clear before the page writes a verdict about it:
// enough distinct videos, the synthesizer itself fairly sure, and (for drop /
// gain patterns) meaningfully lopsided toward its side.
const INSIGHT_MIN_VIDEOS = 3
const INSIGHT_MIN_CONFIDENCE = 0.6
const INSIGHT_MIN_CONTRAST = 0.6
const INSIGHT_MIN_SIGNAL = 35
// Above this the UI labels the signal "strong"; between the minimum and this
// it reads "emerging".
export const SIGNAL_STRONG_THRESHOLD = 60

export type ChannelInsightKind = "fix" | "strength" | "hook"

export interface ChannelInsight {
  kind: ChannelInsightKind
  eventType: RetentionWindowEventType
  videoCount: number
  eventCount: number
  meanConfidence: number
  // Share of the type's weighted presence that sits on the insight's own side
  // (drop-offs for a fix, gains for a strength); null for hooks, which have
  // no opposing side to contrast against.
  contrast: number | null
  // 0..100: 100 × √breadth × confidence × contrast. The square root keeps a
  // genuinely recurring pattern from scoring near zero on a large library.
  signal: number
}

// --- Playbook: decisions earned by contrasting outcomes against holds ------

// Holds are the control group for the playbook: they show the channel's
// successful steady-state behaviour. A rule is only actionable when a pattern
// is materially more common in its target outcome than in that control.
const PLAYBOOK_MIN_PATTERN_VIDEOS = 2
const PLAYBOOK_MIN_COVERAGE_VIDEOS = 2
const PLAYBOOK_MIN_CONFIDENCE = 0.55
const PLAYBOOK_MIN_RATE_LIFT = 0.2
const PLAYBOOK_MIN_SIGNAL = 12
const PLAYBOOK_MAX_RECEIPTS = 3

export type ChannelPlaybookKind = "keep" | "fix" | "recover"

export interface ChannelPlaybookReceipt {
  analysedVideoId: string
  videoTitle: string | null
  timestampSeconds: number | null
  narrative: string
  confidence: number | null
  primaryEvidence: ChannelEventRecord["primaryEvidence"] | null
  windowDelta: number | null
}

export interface ChannelPlaybookRule {
  kind: ChannelPlaybookKind
  eventType: RetentionWindowEventType
  signal: number
  meanConfidence: number
  evidenceVideoCount: number
  targetCoveredVideoCount: number
  controlVideoCount: number
  controlCoveredVideoCount: number
  targetRate: number
  controlRate: number
  rateLift: number
  receipts: ChannelPlaybookReceipt[]
}

export type ChannelKindVideoIds = Partial<
  Record<RetentionWindowKind, string[]>
>

// --- Recurrence: per-type presence across the most recent videos -----------

const RECURRENCE_MAX_VIDEOS = 10
const RECURRENCE_MAX_ROWS_PER_SIDE = 2
// One video is an anecdote; a strip row needs at least two hits' worth of
// history to say anything about recurrence.
const RECURRENCE_MIN_VIDEOS_PER_ROW = 2

export type RecurrenceSide = Extract<RetentionWindowKind, "drop_off" | "gain">

export interface ChannelRecurrenceCell {
  hit: boolean
  // Highest confidence among the hits, null when every hit predates the
  // confidence column.
  maxConfidence: number | null
}

export interface ChannelRecurrenceRow {
  eventType: RetentionWindowEventType
  side: RecurrenceSide
  // Aligned with ChannelRecurrence.videos: oldest first.
  cells: ChannelRecurrenceCell[]
  hitCount: number
  // Consecutive hits ending at the newest video — "still happening".
  currentStreak: number
  // Videos since the last hit (0 = the newest video hit; cells.length =
  // never hit) — "hasn't shown up lately".
  videosSinceLastHit: number
}

export interface ChannelRecurrence {
  // Chronological by analysis date, oldest first, capped at the most recent
  // RECURRENCE_MAX_VIDEOS.
  videos: ChannelVideo[]
  rows: ChannelRecurrenceRow[]
}

// --- Subscriber conversion: which uploads turn viewers into subscribers ----

// Rates are per 1,000 views because raw subscriber counts mostly measure
// reach: +30 subs on 50k views is a worse conversion than +8 on 2k. The
// stored analytics snapshot supplies views and subscribers from the same
// moment, so the ratio stays internally consistent even as a snapshot ages.
//
// Everything here is correlational by construction: a "magnet" is a video
// that converted at a multiple of the channel's typical rate, and the
// patterns block reports which retention-gain / hook event types every magnet
// had that the rest of the library mostly lacked. Subscribing is also driven
// by topic, packaging and who the video reached, so the UI phrases these as
// leads, never causes.

// The section needs a few videos with subscriber data before a median rate —
// and outliers against it — mean anything.
export const SUBSCRIBER_MIN_COVERED_VIDEOS = 3
// A magnet must convert at several times the channel's typical rate AND gain
// a non-trivial absolute count; three subscribers on a hundred views is a
// fluke, not a signal.
const MAGNET_MIN_RATE_RATIO = 3
const MAGNET_MIN_GAINED = 10
// Nearly every video sheds a subscriber or two; a leak verdict needs a
// meaningful net loss.
const LEAK_MIN_NET_LOSS = 5
// A "what the magnets did differently" pattern must appear in EVERY magnet
// and in at most this share of the other covered videos.
const PATTERN_MAX_OTHER_SHARE = 0.5
const MAX_SUBSCRIBER_PATTERNS = 3
const MAX_PATTERN_EVENTS = 2

export type SubscriberOutcome = "magnet" | "typical" | "leak"

export interface SubscriberVideoRow {
  id: string
  title: string | null
  views: number
  subscribersGained: number
  subscribersLost: number | null
  // gained − lost; null when the snapshot never reported losses.
  netGained: number | null
  ratePer1k: number
  outcome: SubscriberOutcome
}

export type SubscriberPatternSide = Extract<RetentionWindowKind, "gain" | "hook">

// One event type every magnet video had (in its gains or its hook) that the
// rest of the covered library mostly lacked — the "what was different about
// that video" evidence, with receipts from the magnets themselves.
export interface SubscriberPattern {
  eventType: RetentionWindowEventType
  side: SubscriberPatternSide
  magnetVideoCount: number
  // How many of the covered non-magnet videos also had it, out of otherTotal.
  otherVideoCount: number
  otherTotal: number
  events: ChannelTrendEvent[]
}

export interface ChannelSubscriberConversion {
  // Covered videos only (a stored snapshot with views and subscribers),
  // sorted by conversion rate, best first.
  rows: SubscriberVideoRow[]
  medianRatePer1k: number
  coveredVideoCount: number
  libraryVideoCount: number
  magnetCount: number
  leakCount: number
  patterns: SubscriberPattern[]
}

// --- Packaging patterns: what high-reach packaging does differently --------

// Reach is views per day between publish and the analytics snapshot, because
// raw view counts can't be compared across a library where one video is two
// years old and another is two weeks old. Both numbers come from the same
// snapshot, so the rate is internally consistent — but it still favours
// recent uploads (views front-load), which the UI says out loud.
//
// The comparison itself is the same contrast move the retention machinery
// uses, applied to the packaging taxonomy: split covered videos into a
// high-reach and a low-reach half, then report the packaging features common
// in the high half and rare in the low half. Correlational by construction.

export const PACKAGING_MIN_COVERED_VIDEOS = 4
// Both reach bands need this many taxonomy-carrying videos before feature
// prevalence between them says anything.
const FEATURE_MIN_BAND_VIDEOS = 2
const FEATURE_MIN_HIGH_SHARE = 2 / 3
const FEATURE_MAX_LOW_SHARE = 1 / 3
const MAX_PACKAGING_FEATURES = 4
// Thumbnail text banding: none, a few words, a wall.
const THUMB_TEXT_HEAVY_WORDS = 4
// Alignment score banding for the tight/loose feature flags.
const ALIGNMENT_TIGHT_SCORE = 0.75
const ALIGNMENT_LOOSE_SCORE = 0.5
// A topic needs a couple of videos and a pronounced reach ratio before the
// page calls it out.
const TOPIC_MIN_VIDEOS = 2
const TOPIC_CALLOUT_RATIO = 1.5
const MAX_TOPIC_ROWS = 3

export type ReachBand = "high" | "middle" | "low"

// A packaging trait as a countable flag. Both directions of a trait exist
// (face / no face) so whichever side splits the bands can surface.
export type PackagingFeature =
  | `title:${TitleStyle}`
  | "thumb:face"
  | "thumb:no_face"
  | "thumb:text_free"
  | "thumb:text_light"
  | "thumb:text_heavy"
  | `promise:${PromiseType}`
  | `hook:${HookDelivery}`
  | "alignment:tight"
  | "alignment:loose"

export interface PackagingReachVideo {
  id: string
  title: string | null
  views: number
  // Days between publish and the analytics snapshot, floored at 1.
  ageDays: number
  viewsPerDay: number
  browseSuggestedShare: number | null
  band: ReachBand
  hasTaxonomy: boolean
}

export interface PackagingFeatureContrast {
  feature: PackagingFeature
  // Prevalence among the taxonomy-carrying videos of each band.
  highCount: number
  highTotal: number
  lowCount: number
  lowTotal: number
}

export interface PackagingTopicReach {
  topic: string
  videoCount: number
  medianViewsPerDay: number
  // vs the covered library's median reach: 2 = twice the typical reach.
  ratio: number
}

export interface ChannelPackagingPatterns {
  // Covered videos sorted by reach, best first.
  videos: PackagingReachVideo[]
  medianViewsPerDay: number
  // Features over-represented in the high-reach band, strongest split first;
  // empty when either band lacks taxonomy coverage.
  features: PackagingFeatureContrast[]
  // Topics whose reach is pronouncedly above or below the channel's typical,
  // highest ratio first.
  topics: PackagingTopicReach[]
  taxonomyVideoCount: number
  coveredVideoCount: number
  libraryVideoCount: number
}

// --- Retention ranking: which uploads hold viewers --------------------------

// The Content tab's anchor, and the outcome its script contrast is split on.
// Average view percentage is already normalised (a share of the video watched),
// so unlike views it can be ranked across a library directly. It still favours
// short uploads, which the UI says out loud by printing each video's length
// alongside it where it has one.
export const RETENTION_RANKING_MIN_VIDEOS = 3

export interface RetentionRankingRow {
  id: string
  title: string | null
  // 0..100.
  retentionPercent: number
  views: number | null
  band: ReachBand
  hasScript: boolean
}

export interface ChannelRetentionRanking {
  // Best-retaining first.
  rows: RetentionRankingRow[]
  medianRetentionPercent: number
  coveredVideoCount: number
  scriptVideoCount: number
  libraryVideoCount: number
}

export function buildRetentionRanking(
  videos: ChannelVideo[],
  libraryVideoCount: number,
): ChannelRetentionRanking | null {
  const covered = videos.filter(
    (video) =>
      video.averageViewPercentage != null && video.averageViewPercentage > 0,
  )
  if (covered.length < RETENTION_RANKING_MIN_VIDEOS) return null

  const sorted = [...covered].sort(
    (a, b) =>
      (b.averageViewPercentage ?? 0) - (a.averageViewPercentage ?? 0) ||
      a.id.localeCompare(b.id),
  )
  const bandSize = Math.floor(sorted.length / 2)
  const bandFor = (index: number): ReachBand =>
    index < bandSize
      ? "high"
      : index >= sorted.length - bandSize
        ? "low"
        : "middle"

  return {
    rows: sorted.map((video, index) => ({
      id: video.id,
      title: video.title,
      retentionPercent: video.averageViewPercentage!,
      views: video.views,
      band: bandFor(index),
      hasScript: video.script != null,
    })),
    medianRetentionPercent: median(
      covered.map((video) => video.averageViewPercentage!),
    ),
    coveredVideoCount: covered.length,
    scriptVideoCount: covered.filter((video) => video.script != null).length,
    libraryVideoCount,
  }
}

// --- Channel snapshot: the library's headline numbers ----------------------

// Medians rather than averages, because a single breakout upload would drag
// every average on a small library. Each figure is null until enough videos
// carry the metric it is measured from, and the page simply omits the tile.
export const SNAPSHOT_MIN_COVERED_VIDEOS = 3

export interface ChannelSnapshot {
  libraryVideoCount: number
  // Views per day since publish, at snapshot time.
  medianViewsPerDay: number | null
  // 0..100, the average share of a video watched.
  medianRetentionPercent: number | null
  // Subscribers gained per 1,000 views.
  medianSubsPer1k: number | null
  // 0..1 impression-weighted thumbnail click-through.
  medianClickThroughRate: number | null
  // Share (0..1) of views arriving from Browse and Suggested, the surfaces
  // packaging has to win.
  medianBrowseSuggestedShare: number | null
}

function medianOrNull(values: number[]): number | null {
  return values.length >= SNAPSHOT_MIN_COVERED_VIDEOS ? median(values) : null
}

export function buildChannelSnapshot(
  videos: ChannelVideo[],
  libraryVideoCount: number,
): ChannelSnapshot {
  return {
    libraryVideoCount,
    medianViewsPerDay: medianOrNull(
      videos.flatMap((video) => {
        const reach = videoReachPerDay(video)
        return reach == null ? [] : [reach]
      }),
    ),
    medianRetentionPercent: medianOrNull(
      videos.flatMap((video) =>
        video.averageViewPercentage == null ? [] : [video.averageViewPercentage],
      ),
    ),
    medianSubsPer1k: medianOrNull(
      videos.flatMap((video) =>
        video.views == null ||
        video.views <= 0 ||
        video.subscribersGained == null
          ? []
          : [(video.subscribersGained / video.views) * 1000],
      ),
    ),
    medianClickThroughRate: medianOrNull(
      videos.flatMap((video) =>
        video.impressionClickThroughRate == null
          ? []
          : [video.impressionClickThroughRate],
      ),
    ),
    medianBrowseSuggestedShare: medianOrNull(
      videos.flatMap((video) =>
        video.browseSuggestedShare == null ? [] : [video.browseSuggestedShare],
      ),
    ),
  }
}

export interface ChannelTrendsData {
  stage: ChannelTrendsStage
  // Distinct videos with a completed event synthesis — the library the
  // progressive unlock is measured against.
  libraryVideoCount: number
  // Retention windows whose events have been synthesized, across all videos.
  windowCount: number
  eventCount: number
  hooks: ChannelKindTrends | null
  dropOffs: ChannelKindTrends | null
  gains: ChannelKindTrends | null
  holds: ChannelKindTrends | null
  // Per-type drop-vs-gain shares, most drop-heavy first; null when no drop or
  // gain events exist yet.
  signature: ChannelSignatureRow[] | null
  // At most one fix, one strength and one hook pattern, in that order — only
  // those that cleared the insight gates.
  insights: ChannelInsight[]
  // At most one keep, fix and recover rule, each contrasted against audience
  // holds and backed by distinct-video evidence receipts.
  playbook: ChannelPlaybookRule[]
  recurrence: ChannelRecurrence | null
  // Null until enough library videos carry an analytics snapshot.
  subscribers: ChannelSubscriberConversion | null
  // Null until enough library videos carry views and a publish date.
  packaging: ChannelPackagingPatterns | null
  // The library's headline medians, for the tiles above the tabs.
  snapshot: ChannelSnapshot
  // The 0-10 packaging axes: the channel's own profile, and where its
  // high-reach half separates from its low-reach half. Null until enough
  // videos carry an enriched (v2) packaging read.
  packagingAxes: ChannelAxisProfile | null
  // The same axes at the ends of the library rather than its halves: the three
  // furthest-reaching uploads against the three that reached least. Null until
  // six videos carry both an enriched packaging read and a reach figure.
  packagingExtremes: ChannelExtremesProfile | null
  // The alignment readout every video report carries, averaged across the
  // library. Null until enough videos carry a packaging read.
  packagingAlignment: ChannelAlignmentAverage | null
  // What the channel's packaging repeats, and which of its choices reach
  // furthest.
  packagingStyle: ChannelStyleProfile | null
  // The same two views over the script taxonomy, contrasted against retention
  // rather than reach: what is said, not what got clicked.
  scriptAxes: ChannelAxisProfile | null
  scriptStyle: ChannelStyleProfile | null
  // Uploads ranked by the share of them that gets watched.
  retentionRanking: ChannelRetentionRanking | null
}

function kindTrends(
  records: ChannelEventRecord[],
  kind: RetentionWindowKind,
  videoTitleById: Map<string, string>,
): ChannelKindTrends | null {
  const kindRecords = records.filter((record) => record.windowKind === kind)
  if (kindRecords.length === 0) return null

  const byType = new Map<RetentionWindowEventType, ChannelEventRecord[]>()
  for (const record of kindRecords) {
    const group = byType.get(record.eventType)
    if (group) group.push(record)
    else byType.set(record.eventType, [record])
  }

  const trends: ChannelTrend[] = [...byType.entries()]
    .map(([eventType, group]) => {
      const videoIds = [...new Set(group.map((r) => r.analysedVideoId))]
      return {
        eventType,
        eventCount: group.length,
        videoCount: videoIds.length,
        events: [...group]
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
          .slice(0, MAX_TREND_EVENTS)
          .map((record) => ({
            narrative: record.narrative,
            videoTitle: videoTitleById.get(record.analysedVideoId) ?? null,
            confidence: record.confidence ?? null,
          })),
      }
    })
    .sort(
      (a, b) => b.videoCount - a.videoCount || b.eventCount - a.eventCount,
    )

  return { eventCount: kindRecords.length, trends }
}

function confidenceWeight(confidence: number | null): number {
  return confidence ?? CONFIDENCE_FALLBACK
}

// Per-side accumulator for one event type while building the signature.
interface SideTypeStats {
  weight: number
  eventCount: number
  videos: Set<string>
}

function accumulateSideStats(
  records: ChannelEventRecord[],
  kind: RetentionWindowKind,
): { byType: Map<RetentionWindowEventType, SideTypeStats>; totalWeight: number } {
  const byType = new Map<RetentionWindowEventType, SideTypeStats>()
  let totalWeight = 0
  for (const record of records) {
    if (record.windowKind !== kind) continue
    const weight = confidenceWeight(record.confidence)
    totalWeight += weight
    const entry =
      byType.get(record.eventType) ??
      ({ weight: 0, eventCount: 0, videos: new Set() } as SideTypeStats)
    entry.weight += weight
    entry.eventCount += 1
    entry.videos.add(record.analysedVideoId)
    byType.set(record.eventType, entry)
  }
  return { byType, totalWeight }
}

function signatureVerdict(row: {
  dropShare: number
  gainShare: number
  videoCount: number
}): SignatureVerdict {
  if (row.videoCount < VERDICT_MIN_VIDEOS) return "insufficient"
  const total = row.dropShare + row.gainShare
  if (total === 0) return "insufficient"
  const dropRatio = row.dropShare / total
  if (dropRatio >= VERDICT_LOPSIDED_RATIO) return "hurting"
  if (dropRatio <= 1 - VERDICT_LOPSIDED_RATIO) return "working"
  return "style"
}

// The drop-vs-gain signature: for every event type seen on either side, its
// confidence-weighted share of each side's events. Balanced rows are the
// channel's editing style; lopsided rows are the signal. Rows are ordered
// most drop-heavy first so the chart reads hurting → style → working.
export function buildChannelSignature(
  records: ChannelEventRecord[],
): ChannelSignatureRow[] | null {
  const drop = accumulateSideStats(records, "drop_off")
  const gain = accumulateSideStats(records, "gain")
  const types = new Set([...drop.byType.keys(), ...gain.byType.keys()])
  if (types.size === 0) return null

  const rows = [...types].map((eventType) => {
    const d = drop.byType.get(eventType)
    const g = gain.byType.get(eventType)
    const dropShare = d && drop.totalWeight > 0 ? d.weight / drop.totalWeight : 0
    const gainShare = g && gain.totalWeight > 0 ? g.weight / gain.totalWeight : 0
    const videoCount = new Set([...(d?.videos ?? []), ...(g?.videos ?? [])]).size
    return {
      eventType,
      dropShare,
      gainShare,
      dropEventCount: d?.eventCount ?? 0,
      gainEventCount: g?.eventCount ?? 0,
      dropVideoCount: d?.videos.size ?? 0,
      gainVideoCount: g?.videos.size ?? 0,
      videoCount,
      verdict: signatureVerdict({ dropShare, gainShare, videoCount }),
    }
  })

  return rows.sort(
    (a, b) =>
      b.dropShare - b.gainShare - (a.dropShare - a.gainShare) ||
      b.dropShare + b.gainShare - (a.dropShare + a.gainShare) ||
      a.eventType.localeCompare(b.eventType),
  )
}

function insightSignal(params: {
  videoCount: number
  libraryVideoCount: number
  meanConfidence: number
  contrast: number | null
}): number {
  if (params.libraryVideoCount <= 0) return 0
  const breadth = Math.min(1, params.videoCount / params.libraryVideoCount)
  return Math.round(
    100 * Math.sqrt(breadth) * params.meanConfidence * (params.contrast ?? 1),
  )
}

// The best drop-side or gain-side pattern that clears every insight gate, or
// null when nothing on that side has earned a written verdict yet.
function sideInsight(
  kind: Extract<ChannelInsightKind, "fix" | "strength">,
  signature: ChannelSignatureRow[] | null,
  drop: ReturnType<typeof accumulateSideStats>,
  gain: ReturnType<typeof accumulateSideStats>,
  libraryVideoCount: number,
): ChannelInsight | null {
  if (signature == null) return null
  const own = kind === "fix" ? drop : gain

  let best: ChannelInsight | null = null
  for (const row of signature) {
    const stats = own.byType.get(row.eventType)
    if (stats == null) continue
    const ownShare = kind === "fix" ? row.dropShare : row.gainShare
    const oppositeShare = kind === "fix" ? row.gainShare : row.dropShare
    const shareTotal = ownShare + oppositeShare
    const contrast = shareTotal === 0 ? 0 : ownShare / shareTotal
    const meanConfidence = stats.weight / stats.eventCount
    const signal = insightSignal({
      videoCount: stats.videos.size,
      libraryVideoCount,
      meanConfidence,
      contrast,
    })
    if (
      stats.videos.size < INSIGHT_MIN_VIDEOS ||
      meanConfidence < INSIGHT_MIN_CONFIDENCE ||
      contrast < INSIGHT_MIN_CONTRAST ||
      signal < INSIGHT_MIN_SIGNAL
    ) {
      continue
    }
    if (best == null || signal > best.signal) {
      best = {
        kind,
        eventType: row.eventType,
        videoCount: stats.videos.size,
        eventCount: stats.eventCount,
        meanConfidence,
        contrast,
        signal,
      }
    }
  }
  return best
}

// Hook windows have no drop/gain polarity, so the hook insight is the opening
// pattern that recurs broadly and confidently — contrast doesn't apply.
function hookInsight(
  records: ChannelEventRecord[],
  libraryVideoCount: number,
): ChannelInsight | null {
  const hooks = accumulateSideStats(records, "hook")
  let best: ChannelInsight | null = null
  for (const [eventType, stats] of hooks.byType) {
    const meanConfidence = stats.weight / stats.eventCount
    const signal = insightSignal({
      videoCount: stats.videos.size,
      libraryVideoCount,
      meanConfidence,
      contrast: null,
    })
    if (
      stats.videos.size < INSIGHT_MIN_VIDEOS ||
      meanConfidence < INSIGHT_MIN_CONFIDENCE ||
      signal < INSIGHT_MIN_SIGNAL
    ) {
      continue
    }
    if (best == null || signal > best.signal) {
      best = {
        kind: "hook",
        eventType,
        videoCount: stats.videos.size,
        eventCount: stats.eventCount,
        meanConfidence,
        contrast: null,
        signal,
      }
    }
  }
  return best
}

export function buildChannelInsights(
  records: ChannelEventRecord[],
  signature: ChannelSignatureRow[] | null,
  libraryVideoCount: number,
): ChannelInsight[] {
  const drop = accumulateSideStats(records, "drop_off")
  const gain = accumulateSideStats(records, "gain")
  const insights = [
    sideInsight("fix", signature, drop, gain, libraryVideoCount),
    sideInsight("strength", signature, drop, gain, libraryVideoCount),
    hookInsight(records, libraryVideoCount),
  ]
  return insights.filter((insight): insight is ChannelInsight => insight != null)
}

function coveredVideoIds(
  records: ChannelEventRecord[],
  kind: RetentionWindowKind,
  supplied: ChannelKindVideoIds | undefined,
): Set<string> {
  const suppliedIds = supplied?.[kind]
  return new Set(
    suppliedIds ??
      records
        .filter((record) => record.windowKind === kind)
        .map((record) => record.analysedVideoId),
  )
}

function playbookReceipts(
  records: ChannelEventRecord[],
  videoTitleById: Map<string, string>,
): ChannelPlaybookReceipt[] {
  const strongestByVideo = new Map<string, ChannelEventRecord>()
  for (const record of records) {
    const current = strongestByVideo.get(record.analysedVideoId)
    if (
      current == null ||
      confidenceWeight(record.confidence) > confidenceWeight(current.confidence)
    ) {
      strongestByVideo.set(record.analysedVideoId, record)
    }
  }

  return [...strongestByVideo.values()]
    .sort((a, b) => confidenceWeight(b.confidence) - confidenceWeight(a.confidence))
    .slice(0, PLAYBOOK_MAX_RECEIPTS)
    .map((record) => ({
      analysedVideoId: record.analysedVideoId,
      videoTitle: videoTitleById.get(record.analysedVideoId) ?? null,
      timestampSeconds: record.timestampSeconds ?? null,
      narrative: record.narrative,
      confidence: record.confidence,
      primaryEvidence: record.primaryEvidence ?? null,
      windowDelta: record.windowDelta ?? null,
    }))
}

// Builds one decision per creator job. Presence is deduplicated per video, so
// a densely edited upload cannot outweigh a pattern recurring channel-wide.
// Empty synthesized windows still count in the denominator when the loader
// supplies completed-window coverage.
export function buildChannelPlaybook(
  records: ChannelEventRecord[],
  videos: ChannelVideo[],
  libraryVideoCount: number,
  kindVideoIds?: ChannelKindVideoIds,
): ChannelPlaybookRule[] {
  const videoTitleById = new Map(
    videos.flatMap((video) =>
      video.title == null ? [] : ([[video.id, video.title]] as const),
    ),
  )
  const configurations = [
    { kind: "keep", target: "hold", control: "drop_off" },
    { kind: "fix", target: "drop_off", control: "hold" },
    { kind: "recover", target: "gain", control: "hold" },
  ] as const

  return configurations.flatMap((configuration) => {
    const targetCoverage = coveredVideoIds(
      records,
      configuration.target,
      kindVideoIds,
    )
    const controlCoverage = coveredVideoIds(
      records,
      configuration.control,
      kindVideoIds,
    )
    if (
      targetCoverage.size < PLAYBOOK_MIN_COVERAGE_VIDEOS ||
      controlCoverage.size < PLAYBOOK_MIN_COVERAGE_VIDEOS
    ) {
      return []
    }

    const eventTypes = new Set(
      records
        .filter((record) => record.windowKind === configuration.target)
        .map((record) => record.eventType),
    )
    const candidates: ChannelPlaybookRule[] = []
    for (const eventType of eventTypes) {
      const targetRecords = records.filter(
        (record) =>
          record.windowKind === configuration.target &&
          record.eventType === eventType,
      )
      const targetVideos = new Set(
        targetRecords.map((record) => record.analysedVideoId),
      )
      const controlVideos = new Set(
        records
          .filter(
            (record) =>
              record.windowKind === configuration.control &&
              record.eventType === eventType,
          )
          .map((record) => record.analysedVideoId),
      )
      const meanConfidence =
        targetRecords.reduce(
          (sum, record) => sum + confidenceWeight(record.confidence),
          0,
        ) / Math.max(1, targetRecords.length)
      const targetRate = targetVideos.size / targetCoverage.size
      const controlRate = controlVideos.size / controlCoverage.size
      const rateLift = targetRate - controlRate
      const breadth =
        libraryVideoCount > 0
          ? Math.min(1, targetVideos.size / libraryVideoCount)
          : 0
      const signal = Math.round(
        100 * Math.sqrt(breadth) * meanConfidence * Math.max(0, rateLift),
      )

      if (
        targetVideos.size < PLAYBOOK_MIN_PATTERN_VIDEOS ||
        meanConfidence < PLAYBOOK_MIN_CONFIDENCE ||
        rateLift < PLAYBOOK_MIN_RATE_LIFT ||
        signal < PLAYBOOK_MIN_SIGNAL
      ) {
        continue
      }

      candidates.push({
        kind: configuration.kind,
        eventType,
        signal,
        meanConfidence,
        evidenceVideoCount: targetVideos.size,
        targetCoveredVideoCount: targetCoverage.size,
        controlVideoCount: controlVideos.size,
        controlCoveredVideoCount: controlCoverage.size,
        targetRate,
        controlRate,
        rateLift,
        receipts: playbookReceipts(targetRecords, videoTitleById),
      })
    }

    candidates.sort(
      (a, b) =>
        b.signal - a.signal ||
        b.rateLift - a.rateLift ||
        a.eventType.localeCompare(b.eventType),
    )
    return candidates.slice(0, 1)
  })
}

// Orders library videos chronologically by analysis date (undated first, so
// they age out of the strip soonest), tiebroken by id for determinism.
function chronological(videos: ChannelVideo[]): ChannelVideo[] {
  return [...videos].sort(
    (a, b) =>
      (a.dateAnalysed ?? "").localeCompare(b.dateAnalysed ?? "") ||
      a.id.localeCompare(b.id),
  )
}

// The recurrence strip: for the most channel-wide drop and gain patterns,
// which of the most recent videos each one appeared in. This is what makes
// change visible — a streak still running, or a pattern gone quiet after the
// creator acted on it.
export function buildChannelRecurrence(
  records: ChannelEventRecord[],
  videos: ChannelVideo[],
  signature: ChannelSignatureRow[] | null,
): ChannelRecurrence | null {
  if (signature == null) return null
  const recent = chronological(videos).slice(-RECURRENCE_MAX_VIDEOS)
  if (recent.length < RECURRENCE_MIN_VIDEOS_PER_ROW) return null

  const pick = (side: RecurrenceSide): ChannelSignatureRow[] =>
    [...signature]
      .filter((row) =>
        side === "drop_off"
          ? row.dropVideoCount >= RECURRENCE_MIN_VIDEOS_PER_ROW
          : row.gainVideoCount >= RECURRENCE_MIN_VIDEOS_PER_ROW,
      )
      .sort((a, b) =>
        side === "drop_off"
          ? b.dropShare - a.dropShare
          : b.gainShare - a.gainShare,
      )
      .slice(0, RECURRENCE_MAX_ROWS_PER_SIDE)

  // Max confidence per (video, side, type) across the hits in that video.
  const hitConfidence = new Map<string, number | null>()
  for (const record of records) {
    if (record.windowKind === "hook") continue
    const key = `${record.analysedVideoId} ${record.windowKind} ${record.eventType}`
    const existing = hitConfidence.get(key)
    const next =
      record.confidence == null
        ? existing ?? null
        : Math.max(existing ?? 0, record.confidence)
    hitConfidence.set(key, next)
  }

  const buildRow = (
    row: ChannelSignatureRow,
    side: RecurrenceSide,
  ): ChannelRecurrenceRow => {
    const cells = recent.map((video) => {
      const key = `${video.id} ${side} ${row.eventType}`
      const hit = hitConfidence.has(key)
      return { hit, maxConfidence: hit ? hitConfidence.get(key) ?? null : null }
    })
    let currentStreak = 0
    for (let i = cells.length - 1; i >= 0 && cells[i].hit; i--) currentStreak++
    let videosSinceLastHit = cells.length
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].hit) {
        videosSinceLastHit = cells.length - 1 - i
        break
      }
    }
    return {
      eventType: row.eventType,
      side,
      cells,
      hitCount: cells.filter((cell) => cell.hit).length,
      currentStreak,
      videosSinceLastHit,
    }
  }

  const rows = [
    ...pick("drop_off").map((row) => buildRow(row, "drop_off")),
    ...pick("gain").map((row) => buildRow(row, "gain")),
  ]
  if (rows.length === 0) return null
  return { videos: recent, rows }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

// The contrast pass behind "what your subscriber magnets did differently":
// event types present in every magnet's gain or hook windows but rare across
// the other covered videos. Drop-off events are excluded — something that
// showed up where viewers left is not a candidate explanation for gained
// subscribers.
function subscriberPatterns(
  records: ChannelEventRecord[],
  magnetIds: Set<string>,
  otherIds: Set<string>,
  videoTitleById: Map<string, string>,
): SubscriberPattern[] {
  if (magnetIds.size === 0 || otherIds.size === 0) return []

  interface PatternStats {
    magnetVideos: Set<string>
    otherVideos: Set<string>
    magnetRecords: ChannelEventRecord[]
  }
  const byKey = new Map<string, PatternStats>()
  for (const record of records) {
    if (record.windowKind !== "gain" && record.windowKind !== "hook") continue
    const isMagnet = magnetIds.has(record.analysedVideoId)
    if (!isMagnet && !otherIds.has(record.analysedVideoId)) continue
    const key = `${record.windowKind} ${record.eventType}`
    const stats =
      byKey.get(key) ??
      ({
        magnetVideos: new Set(),
        otherVideos: new Set(),
        magnetRecords: [],
      } as PatternStats)
    if (isMagnet) {
      stats.magnetVideos.add(record.analysedVideoId)
      stats.magnetRecords.push(record)
    } else {
      stats.otherVideos.add(record.analysedVideoId)
    }
    byKey.set(key, stats)
  }

  return [...byKey.entries()]
    .filter(
      ([, stats]) =>
        stats.magnetVideos.size === magnetIds.size &&
        stats.otherVideos.size / otherIds.size <= PATTERN_MAX_OTHER_SHARE,
    )
    .map(([key, stats]) => {
      const [side, eventType] = key.split(" ") as [
        SubscriberPatternSide,
        RetentionWindowEventType,
      ]
      return {
        eventType,
        side,
        magnetVideoCount: stats.magnetVideos.size,
        otherVideoCount: stats.otherVideos.size,
        otherTotal: otherIds.size,
        events: [...stats.magnetRecords]
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
          .slice(0, MAX_PATTERN_EVENTS)
          .map((record) => ({
            narrative: record.narrative,
            videoTitle: videoTitleById.get(record.analysedVideoId) ?? null,
            confidence: record.confidence ?? null,
          })),
      }
    })
    .sort(
      (a, b) =>
        a.otherVideoCount - b.otherVideoCount ||
        (b.events[0]?.confidence ?? 0) - (a.events[0]?.confidence ?? 0) ||
        a.eventType.localeCompare(b.eventType),
    )
    .slice(0, MAX_SUBSCRIBER_PATTERNS)
}

// The subscriber conversion view: per-1k-views rates for every covered video,
// robust outlier flags against the channel median, and the pattern contrast
// for the magnets. Null until enough videos carry subscriber data.
export function buildSubscriberConversion(
  records: ChannelEventRecord[],
  videos: ChannelVideo[],
  libraryVideoCount: number,
): ChannelSubscriberConversion | null {
  const covered = videos.filter(
    (video) =>
      video.views != null && video.views > 0 && video.subscribersGained != null,
  )
  if (covered.length < SUBSCRIBER_MIN_COVERED_VIDEOS) return null

  const medianRatePer1k = median(
    covered.map((video) => (video.subscribersGained! / video.views!) * 1000),
  )

  const rows: SubscriberVideoRow[] = covered
    .map((video) => {
      const views = video.views!
      const subscribersGained = video.subscribersGained!
      const subscribersLost = video.subscribersLost
      const netGained =
        subscribersLost == null ? null : subscribersGained - subscribersLost
      const ratePer1k = (subscribersGained / views) * 1000
      // A net loss outranks a strong gross rate: the channel shrank.
      const outcome: SubscriberOutcome =
        netGained != null && netGained <= -LEAK_MIN_NET_LOSS
          ? "leak"
          : subscribersGained >= MAGNET_MIN_GAINED &&
              (medianRatePer1k === 0
                ? ratePer1k > 0
                : ratePer1k >= MAGNET_MIN_RATE_RATIO * medianRatePer1k)
            ? "magnet"
            : "typical"
      return {
        id: video.id,
        title: video.title,
        views,
        subscribersGained,
        subscribersLost: subscribersLost ?? null,
        netGained,
        ratePer1k,
        outcome,
      }
    })
    .sort((a, b) => b.ratePer1k - a.ratePer1k || a.id.localeCompare(b.id))

  const videoTitleById = new Map<string, string>()
  for (const video of covered) {
    if (video.title != null) videoTitleById.set(video.id, video.title)
  }
  const magnetIds = new Set(
    rows.filter((row) => row.outcome === "magnet").map((row) => row.id),
  )
  const otherIds = new Set(
    rows.filter((row) => row.outcome !== "magnet").map((row) => row.id),
  )

  return {
    rows,
    medianRatePer1k,
    coveredVideoCount: covered.length,
    libraryVideoCount,
    magnetCount: magnetIds.size,
    leakCount: rows.filter((row) => row.outcome === "leak").length,
    patterns: subscriberPatterns(records, magnetIds, otherIds, videoTitleById),
  }
}

// Flattens a taxonomy into the countable trait flags the band contrast runs
// over.
export function packagingFeatures(
  taxonomy: PackagingTaxonomy,
): PackagingFeature[] {
  const features: PackagingFeature[] = taxonomy.titleStyles.map(
    (style): PackagingFeature => `title:${style}`,
  )
  features.push(taxonomy.thumbnailHasFace ? "thumb:face" : "thumb:no_face")
  features.push(
    taxonomy.thumbnailTextWordCount === 0
      ? "thumb:text_free"
      : taxonomy.thumbnailTextWordCount < THUMB_TEXT_HEAVY_WORDS
        ? "thumb:text_light"
        : "thumb:text_heavy",
  )
  features.push(`promise:${taxonomy.promiseType}`)
  features.push(`hook:${taxonomy.hookDelivery}`)
  if (taxonomy.alignmentScore >= ALIGNMENT_TIGHT_SCORE) {
    features.push("alignment:tight")
  } else if (taxonomy.alignmentScore < ALIGNMENT_LOOSE_SCORE) {
    features.push("alignment:loose")
  }
  return features
}

// Packaging features common in the high-reach band and rare in the low-reach
// band. Both bands must carry enough taxonomies; the middle band (odd counts)
// never votes.
function packagingFeatureContrasts(
  high: PackagingTaxonomy[],
  low: PackagingTaxonomy[],
): PackagingFeatureContrast[] {
  if (high.length < FEATURE_MIN_BAND_VIDEOS || low.length < FEATURE_MIN_BAND_VIDEOS) {
    return []
  }

  const count = (band: PackagingTaxonomy[]): Map<PackagingFeature, number> => {
    const counts = new Map<PackagingFeature, number>()
    for (const taxonomy of band) {
      for (const feature of new Set(packagingFeatures(taxonomy))) {
        counts.set(feature, (counts.get(feature) ?? 0) + 1)
      }
    }
    return counts
  }
  const highCounts = count(high)
  const lowCounts = count(low)

  return [...highCounts.entries()]
    .map(([feature, highCount]) => ({
      feature,
      highCount,
      highTotal: high.length,
      lowCount: lowCounts.get(feature) ?? 0,
      lowTotal: low.length,
    }))
    .filter(
      (row) =>
        row.highCount / row.highTotal >= FEATURE_MIN_HIGH_SHARE &&
        row.lowCount / row.lowTotal <= FEATURE_MAX_LOW_SHARE,
    )
    .sort(
      (a, b) =>
        b.highCount / b.highTotal -
          b.lowCount / b.lowTotal -
          (a.highCount / a.highTotal - a.lowCount / a.lowTotal) ||
        b.highCount - a.highCount ||
        a.feature.localeCompare(b.feature),
    )
    .slice(0, MAX_PACKAGING_FEATURES)
}

// Topics whose median reach sits pronouncedly above or below the channel's
// typical reach.
function packagingTopicReach(
  videos: { viewsPerDay: number; topics: string[] }[],
  medianViewsPerDay: number,
): PackagingTopicReach[] {
  if (medianViewsPerDay <= 0) return []

  const byTopic = new Map<string, number[]>()
  for (const video of videos) {
    for (const topic of new Set(video.topics)) {
      const rates = byTopic.get(topic)
      if (rates) rates.push(video.viewsPerDay)
      else byTopic.set(topic, [video.viewsPerDay])
    }
  }

  return [...byTopic.entries()]
    .filter(([, rates]) => rates.length >= TOPIC_MIN_VIDEOS)
    .map(([topic, rates]) => {
      const medianRate = median(rates)
      return {
        topic,
        videoCount: rates.length,
        medianViewsPerDay: medianRate,
        ratio: medianRate / medianViewsPerDay,
      }
    })
    .filter(
      (row) =>
        row.ratio >= TOPIC_CALLOUT_RATIO || row.ratio <= 1 / TOPIC_CALLOUT_RATIO,
    )
    .sort((a, b) => b.ratio - a.ratio || a.topic.localeCompare(b.topic))
    .slice(0, MAX_TOPIC_ROWS)
}

// The packaging patterns view: per-video reach (views/day at snapshot time),
// a high/low band split, and the packaging features and topics that separate
// the bands. Null until enough videos carry both views and a publish date.
export function buildPackagingPatterns(
  videos: ChannelVideo[],
  libraryVideoCount: number,
): ChannelPackagingPatterns | null {
  const covered = videos.flatMap((video) => {
    if (video.views == null || video.views <= 0) return []
    const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN
    const fetched = video.analyticsFetchedAt
      ? Date.parse(video.analyticsFetchedAt)
      : NaN
    if (!Number.isFinite(published) || !Number.isFinite(fetched)) return []
    const ageDays = Math.max(1, Math.round((fetched - published) / DAY_MS))
    return [
      {
        video,
        views: video.views,
        ageDays,
        viewsPerDay: video.views / ageDays,
      },
    ]
  })
  if (covered.length < PACKAGING_MIN_COVERED_VIDEOS) return null

  covered.sort(
    (a, b) =>
      b.viewsPerDay - a.viewsPerDay || a.video.id.localeCompare(b.video.id),
  )
  const bandSize = Math.floor(covered.length / 2)
  const bandFor = (index: number): ReachBand =>
    index < bandSize
      ? "high"
      : index >= covered.length - bandSize
        ? "low"
        : "middle"

  const rows: PackagingReachVideo[] = covered.map((entry, index) => ({
    id: entry.video.id,
    title: entry.video.title,
    views: entry.views,
    ageDays: entry.ageDays,
    viewsPerDay: entry.viewsPerDay,
    browseSuggestedShare: entry.video.browseSuggestedShare,
    band: bandFor(index),
    hasTaxonomy: entry.video.packaging != null,
  }))

  const bandTaxonomies = (band: ReachBand): PackagingTaxonomy[] =>
    covered
      .filter((entry, index) => bandFor(index) === band)
      .flatMap((entry) => entry.video.packaging ?? [])

  const medianViewsPerDay = median(covered.map((entry) => entry.viewsPerDay))
  return {
    videos: rows,
    medianViewsPerDay,
    features: packagingFeatureContrasts(
      bandTaxonomies("high"),
      bandTaxonomies("low"),
    ),
    topics: packagingTopicReach(
      covered.map((entry) => ({
        viewsPerDay: entry.viewsPerDay,
        topics: videoTopics(entry.video),
      })),
      medianViewsPerDay,
    ),
    taxonomyVideoCount: covered.filter((entry) => entry.video.packaging != null)
      .length,
    coveredVideoCount: covered.length,
    libraryVideoCount,
  }
}

// Pure aggregation over already-loaded inputs, split from the loader so tests
// don't need a database.
export function buildChannelTrends(params: {
  records: ChannelEventRecord[]
  videos: ChannelVideo[]
  libraryVideoCount: number
  windowCount: number
  kindVideoIds?: ChannelKindVideoIds
}): ChannelTrendsData {
  const { records, videos, libraryVideoCount, windowCount, kindVideoIds } = params
  const videoTitleById = new Map<string, string>()
  for (const video of videos) {
    if (video.title != null) videoTitleById.set(video.id, video.title)
  }
  const signature = buildChannelSignature(records)
  return {
    stage: channelTrendsStage(libraryVideoCount),
    libraryVideoCount,
    windowCount,
    eventCount: records.length,
    hooks: kindTrends(records, "hook", videoTitleById),
    dropOffs: kindTrends(records, "drop_off", videoTitleById),
    gains: kindTrends(records, "gain", videoTitleById),
    holds: kindTrends(records, "hold", videoTitleById),
    signature,
    insights: buildChannelInsights(records, signature, libraryVideoCount),
    playbook: buildChannelPlaybook(
      records,
      videos,
      libraryVideoCount,
      kindVideoIds,
    ),
    recurrence: buildChannelRecurrence(records, videos, signature),
    subscribers: buildSubscriberConversion(records, videos, libraryVideoCount),
    packaging: buildPackagingPatterns(videos, libraryVideoCount),
    snapshot: buildChannelSnapshot(videos, libraryVideoCount),
    packagingAxes: buildChannelAxisProfile({
      videos,
      source: "packaging",
      outcome: "reach",
      outcomeOf: videoReachPerDay,
    }),
    packagingExtremes: buildChannelExtremesProfile({
      videos,
      source: "packaging",
      outcome: "reach",
      outcomeOf: videoReachPerDay,
    }),
    packagingAlignment: buildChannelAlignmentAverage(videos),
    packagingStyle: buildChannelStyleProfile({
      videos,
      source: "packaging",
      outcome: "reach",
      outcomeOf: videoReachPerDay,
    }),
    scriptAxes: buildChannelAxisProfile({
      videos,
      source: "script",
      outcome: "retention",
      outcomeOf: (video) => video.averageViewPercentage,
    }),
    scriptStyle: buildChannelStyleProfile({
      videos,
      source: "script",
      outcome: "retention",
      outcomeOf: (video) => video.averageViewPercentage,
    }),
    retentionRanking: buildRetentionRanking(videos, libraryVideoCount),
  }
}

// The library's size: every window whose event synthesis completed, and the
// distinct videos those windows belong to. Counted from the synthesis jobs
// (not the events) so a deeply-analysed video still grows the library even if
// a window produced no events.
async function loadLibrarySize(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  libraryVideoCount: number
  windowCount: number
  videoIds: string[]
  kindVideoIds: ChannelKindVideoIds
}> {
  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id, retention_windows!inner(kind)")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (error) {
    throw new Error(`Failed to load channel library size: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as {
    analysed_video_id: string
    retention_windows: { kind: string } | { kind: string }[] | null
  }[]
  const videoIds = [...new Set(rows.map((row) => row.analysed_video_id))]
  const kinds: RetentionWindowKind[] = ["hook", "drop_off", "gain", "hold"]
  const kindVideoIds: ChannelKindVideoIds = {}
  for (const kind of kinds) {
    kindVideoIds[kind] = [
      ...new Set(
        rows.flatMap((row) => {
          const window = Array.isArray(row.retention_windows)
            ? row.retention_windows[0]
            : row.retention_windows
          return window?.kind === kind ? [row.analysed_video_id] : []
        }),
      ),
    ]
  }
  return {
    libraryVideoCount: videoIds.length,
    windowCount: rows.length,
    videoIds,
    kindVideoIds,
  }
}

// The traffic-source codes YouTube attributes to its packaging-driven
// surfaces: Browse features (home/subscriptions feed) and Suggested videos.
const PACKAGING_TRAFFIC_SOURCES = new Set(["SUBSCRIBER", "RELATED_VIDEO"])

function browseSuggestedShare(
  trafficSources: { source?: string; views?: number }[] | undefined,
): number | null {
  if (!trafficSources || trafficSources.length === 0) return null
  let total = 0
  let packagingDriven = 0
  for (const bucket of trafficSources) {
    const views = bucket.views ?? 0
    total += views
    if (bucket.source && PACKAGING_TRAFFIC_SOURCES.has(bucket.source)) {
      packagingDriven += views
    }
  }
  return total > 0 ? packagingDriven / total : null
}

// Title, analysis date, analytics snapshot and packaging taxonomy for every
// video the page touches — event attribution, the recurrence strip's
// chronological columns, the subscriber conversion view and the packaging
// patterns view all read from this. JSON-path selects keep the payload to the
// fields used instead of shipping whole video_details/packaging_alignment
// documents.
async function loadVideos(
  supabase: SupabaseClient,
  userId: string,
  videoIds: string[],
): Promise<ChannelVideo[]> {
  if (videoIds.length === 0) return []

  const { data, error } = await supabase
    .from("analysed_videos")
    .select(
      "id, video_title, date_analysed, analytics_summary, published_at:video_details->>publishedAt, packaging_taxonomy:packaging_alignment->taxonomy, script_taxonomy",
    )
    .eq("user_id", userId)
    .in("id", videoIds)

  if (error) {
    throw new Error(`Failed to load video titles: ${error.message}`)
  }

  return (
    (data ?? []) as unknown as {
      id: string
      video_title: string | null
      date_analysed: string | null
      analytics_summary: {
        views?: number | null
        subscribersGained?: number | null
        subscribersLost?: number | null
        averageViewPercentage?: number | null
        impressionClickThroughRate?: number | null
        trafficSources?: { source?: string; views?: number }[]
        fetchedAt?: string | null
      } | null
      published_at: string | null
      packaging_taxonomy: PackagingTaxonomy | null
      script_taxonomy: ScriptTaxonomy | null
    }[]
  ).map((row) => ({
    id: row.id,
    title: row.video_title,
    dateAnalysed: row.date_analysed,
    views: row.analytics_summary?.views ?? null,
    subscribersGained: row.analytics_summary?.subscribersGained ?? null,
    subscribersLost: row.analytics_summary?.subscribersLost ?? null,
    publishedAt: row.published_at,
    analyticsFetchedAt: row.analytics_summary?.fetchedAt ?? null,
    browseSuggestedShare: browseSuggestedShare(
      row.analytics_summary?.trafficSources,
    ),
    averageViewPercentage: row.analytics_summary?.averageViewPercentage ?? null,
    impressionClickThroughRate:
      row.analytics_summary?.impressionClickThroughRate ?? null,
    packaging: row.packaging_taxonomy,
    script: row.script_taxonomy,
  }))
}

export async function getChannelTrends(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChannelTrendsData> {
  const [records, librarySize] = await Promise.all([
    loadChannelEventRecords(supabase, userId, { limit: MAX_EVENT_ROWS }),
    loadLibrarySize(supabase, userId),
  ])
  // The union, because a library video can have zero events (its columns in
  // the recurrence strip stay empty) and an event can outlive its library row.
  const videos = await loadVideos(supabase, userId, [
    ...new Set([
      ...records.map((record) => record.analysedVideoId),
      ...librarySize.videoIds,
    ]),
  ])
  return buildChannelTrends({
    records,
    videos,
    libraryVideoCount: librarySize.libraryVideoCount,
    windowCount: librarySize.windowCount,
    kindVideoIds: librarySize.kindVideoIds,
  })
}
