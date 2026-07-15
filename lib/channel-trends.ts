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
import type { RetentionWindowEventType } from "@/lib/retention-window-events"
import type { RetentionWindowKind } from "@/lib/retention-windows"

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
// analysis date to order the recurrence strip's columns, and the lifetime
// totals from the analytics snapshot stored at analyse time — null when the
// video predates the analytics_summary column or a metric wasn't reported.
export interface ChannelVideo {
  id: string
  title: string | null
  dateAnalysed: string | null
  views: number | null
  subscribersGained: number | null
  subscribersLost: number | null
}

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
  // Per-type drop-vs-gain shares, most drop-heavy first; null when no drop or
  // gain events exist yet.
  signature: ChannelSignatureRow[] | null
  // At most one fix, one strength and one hook pattern, in that order — only
  // those that cleared the insight gates.
  insights: ChannelInsight[]
  recurrence: ChannelRecurrence | null
  // Null until enough library videos carry an analytics snapshot.
  subscribers: ChannelSubscriberConversion | null
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

// Pure aggregation over already-loaded inputs, split from the loader so tests
// don't need a database.
export function buildChannelTrends(params: {
  records: ChannelEventRecord[]
  videos: ChannelVideo[]
  libraryVideoCount: number
  windowCount: number
}): ChannelTrendsData {
  const { records, videos, libraryVideoCount, windowCount } = params
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
    signature,
    insights: buildChannelInsights(records, signature, libraryVideoCount),
    recurrence: buildChannelRecurrence(records, videos, signature),
    subscribers: buildSubscriberConversion(records, videos, libraryVideoCount),
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
}> {
  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (error) {
    throw new Error(`Failed to load channel library size: ${error.message}`)
  }

  const rows = (data ?? []) as { analysed_video_id: string }[]
  const videoIds = [...new Set(rows.map((row) => row.analysed_video_id))]
  return {
    libraryVideoCount: videoIds.length,
    windowCount: rows.length,
    videoIds,
  }
}

// Title, analysis date and analytics snapshot for every video the page
// touches — event attribution, the recurrence strip's chronological columns
// and the subscriber conversion view all read from this.
async function loadVideos(
  supabase: SupabaseClient,
  userId: string,
  videoIds: string[],
): Promise<ChannelVideo[]> {
  if (videoIds.length === 0) return []

  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_title, date_analysed, analytics_summary")
    .eq("user_id", userId)
    .in("id", videoIds)

  if (error) {
    throw new Error(`Failed to load video titles: ${error.message}`)
  }

  return (
    (data ?? []) as {
      id: string
      video_title: string | null
      date_analysed: string | null
      analytics_summary: {
        views?: number | null
        subscribersGained?: number | null
        subscribersLost?: number | null
      } | null
    }[]
  ).map((row) => ({
    id: row.id,
    title: row.video_title,
    dateAnalysed: row.date_analysed,
    views: row.analytics_summary?.views ?? null,
    subscribersGained: row.analytics_summary?.subscribersGained ?? null,
    subscribersLost: row.analytics_summary?.subscribersLost ?? null,
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
  })
}
