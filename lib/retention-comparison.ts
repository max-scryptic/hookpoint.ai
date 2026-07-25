// The video-vs-video retention comparison: two library videos side by side,
// built curve-first. The full stored retention curves are the spine (they
// exist for every analysed video, uncapped), and the synthesized window
// events are annotations on the stretches that were deeply analysed - never
// the other way round, because deep analysis covers only each video's
// highest-priority windows (see lib/deep-analysis-window-selection.ts), so an
// events-only comparison would silently compare asymmetric evidence.
//
// Event ranking is calibrated by the user's own feedback: the helpful rate
// per primary-evidence type (the same split lib/deep-analysis-quality-metrics
// reports) scales each event's model confidence, so evidence sources the user
// has repeatedly marked unhelpful sink in the ordering. With no feedback the
// calibration is neutral and ordering falls back to raw confidence.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included) - it feeds the Channel Trends surface. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  RetentionWindowEventPrimaryEvidence,
  RetentionWindowEventType,
} from "@/lib/retention-window-events"
import type { RetentionWindowKind } from "@/lib/retention-windows"
import type { RetentionPoint } from "@/lib/youtube/youtube"

// ---------------------------------------------------------------------------
// Types

export interface ComparisonVideoSummary {
  id: string
  title: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  durationSeconds: number
  views: number | null
  averageViewDurationSeconds: number | null
  // 0..100 as YouTube reports it.
  averageViewPercentage: number | null
  netSubscribersGained: number | null
}

export interface ComparisonEvent {
  eventType: RetentionWindowEventType
  timestampSeconds: number | null
  narrative: string
  primaryEvidence: RetentionWindowEventPrimaryEvidence | null
  confidence: number | null
  // confidence x feedback calibration - the sort key, not a probability.
  weight: number
}

export interface ComparisonWindow {
  id: string
  kind: RetentionWindowKind
  fromSeconds: number
  toSeconds: number
  // Signed watch-ratio change across the window; negative for losses.
  delta: number
  relativePerformance: number | null
  // True when this window's event synthesis completed - the only stretches
  // with event evidence. Windows outside this set still render on the curve
  // but must be labelled as not deeply analysed.
  deeplyAnalysed: boolean
  // Ordered by weight desc.
  events: ComparisonEvent[]
}

export interface ComparisonVideo {
  summary: ComparisonVideoSummary
  // Sorted by elapsedRatio.
  curve: RetentionPoint[]
  // Chronological.
  windows: ComparisonWindow[]
  hook: ComparisonWindow | null
  // Share of viewers still watching at the end of the hook window (or at the
  // 30s mark when no hook window exists). Null when there is no curve.
  hookHoldRatio: number | null
  deeplyAnalysedWindowCount: number
}

// The stretch where the gap between the two curves widened the most, in
// normalized position (0..1 of each video's runtime). "widenedFor" names the
// video that gained the most relative ground across the stretch.
export interface CurveDivergence {
  fromRatio: number
  toRatio: number
  widenedFor: "a" | "b"
  // How much the gap grew across the stretch, in watch-ratio points.
  gapChange: number
  aFromRatio: number
  aToRatio: number
  bFromRatio: number
  bToRatio: number
}

export interface EvidenceCalibration {
  // Smoothed helpful rate per evidence type, 0..1; 0.5 when unobserved.
  rates: Partial<Record<RetentionWindowEventPrimaryEvidence, number>>
  feedbackCount: number
}

export interface RetentionComparisonData {
  a: ComparisonVideo
  b: ComparisonVideo
  divergence: CurveDivergence | null
  // How many feedback ratings informed the event calibration; 0 means the
  // ordering is raw model confidence.
  feedbackCount: number
}

// A row of the compare page's video picker.
export interface ComparableVideo {
  id: string
  title: string | null
  dateAnalysed: string | null
  averageViewPercentage: number | null
}

// ---------------------------------------------------------------------------
// Pure builders (exported for tests)

// Matches the channel-trends treatment of unranked events.
const CONFIDENCE_FALLBACK = 0.6
// Additive smoothing on the per-evidence helpful rate: one phantom helpful
// and one phantom unhelpful, so a single rating never drags a source to 0 or 1.
const CALIBRATION_PRIOR_HELPFUL = 1
const CALIBRATION_PRIOR_TOTAL = 2
// Gaps smaller than this (in watch-ratio points) are noise, not divergence.
const MIN_DIVERGENCE = 0.05
const DIVERGENCE_SAMPLES = 60
const HOOK_FALLBACK_SECONDS = 30
const MAX_EVENTS_PER_WINDOW = 3

export function computeEvidenceCalibration(
  ratings: Array<{
    rating: "helpful" | "not_helpful"
    primaryEvidence: RetentionWindowEventPrimaryEvidence
  }>,
): EvidenceCalibration {
  const tallies = new Map<
    RetentionWindowEventPrimaryEvidence,
    { helpful: number; total: number }
  >()
  for (const row of ratings) {
    const tally = tallies.get(row.primaryEvidence) ?? { helpful: 0, total: 0 }
    tally.total += 1
    if (row.rating === "helpful") tally.helpful += 1
    tallies.set(row.primaryEvidence, tally)
  }
  const rates: EvidenceCalibration["rates"] = {}
  for (const [evidence, tally] of tallies) {
    rates[evidence] =
      (tally.helpful + CALIBRATION_PRIOR_HELPFUL) /
      (tally.total + CALIBRATION_PRIOR_TOTAL)
  }
  return { rates, feedbackCount: ratings.length }
}

// The multiplier an event's confidence is scaled by: 1.0 when the evidence
// type is unobserved, drifting toward 0.5 or 1.5 as feedback accumulates.
export function calibrationFactor(
  calibration: EvidenceCalibration,
  evidence: RetentionWindowEventPrimaryEvidence | null,
): number {
  if (evidence == null) return 1
  const rate = calibration.rates[evidence]
  if (rate == null) return 1
  return 0.5 + rate
}

export function eventWeight(
  calibration: EvidenceCalibration,
  event: Pick<ComparisonEvent, "confidence" | "primaryEvidence">,
): number {
  const confidence = event.confidence ?? CONFIDENCE_FALLBACK
  return confidence * calibrationFactor(calibration, event.primaryEvidence)
}

// Linear interpolation of the watch ratio at a normalized position, with the
// same synthetic 0:00 = 100% baseline the retention chart draws.
export function watchRatioAt(
  curve: RetentionPoint[],
  ratio: number,
): number | null {
  if (curve.length === 0) return null
  const sorted = [...curve].sort((a, b) => a.elapsedRatio - b.elapsedRatio)
  const points = [
    { elapsedRatio: 0, watchRatio: 1 },
    ...sorted.filter((point) => point.elapsedRatio > 0),
  ]
  const clamped = Math.min(1, Math.max(0, ratio))
  if (clamped <= points[0].elapsedRatio) return points[0].watchRatio
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    if (clamped <= current.elapsedRatio) {
      const span = current.elapsedRatio - previous.elapsedRatio
      const progress = span > 0 ? (clamped - previous.elapsedRatio) / span : 0
      return (
        previous.watchRatio +
        (current.watchRatio - previous.watchRatio) * progress
      )
    }
  }
  return points[points.length - 1].watchRatio
}

// Finds the stretch where one curve gained the most ground on the other:
// the largest rise of (a - b) for a, of (b - a) for b, whichever is bigger.
// Null when either curve is missing or the biggest rise is below the noise
// floor.
export function findLargestDivergence(
  curveA: RetentionPoint[],
  curveB: RetentionPoint[],
): CurveDivergence | null {
  if (curveA.length === 0 || curveB.length === 0) return null

  const samples: Array<{ ratio: number; a: number; b: number }> = []
  for (let i = 0; i <= DIVERGENCE_SAMPLES; i++) {
    const ratio = i / DIVERGENCE_SAMPLES
    const a = watchRatioAt(curveA, ratio)
    const b = watchRatioAt(curveB, ratio)
    if (a == null || b == null) return null
    samples.push({ ratio, a, b })
  }

  const bestRise = (gapAt: (sample: { a: number; b: number }) => number) => {
    let minGap = gapAt(samples[0])
    let minIndex = 0
    let best = { rise: 0, from: 0, to: 0 }
    for (let i = 1; i < samples.length; i++) {
      const gap = gapAt(samples[i])
      if (gap - minGap > best.rise) {
        best = { rise: gap - minGap, from: minIndex, to: i }
      }
      if (gap < minGap) {
        minGap = gap
        minIndex = i
      }
    }
    return best
  }

  const forA = bestRise((sample) => sample.a - sample.b)
  const forB = bestRise((sample) => sample.b - sample.a)
  const widenedFor = forA.rise >= forB.rise ? "a" : "b"
  const best = widenedFor === "a" ? forA : forB
  if (best.rise < MIN_DIVERGENCE) return null

  const from = samples[best.from]
  const to = samples[best.to]
  return {
    fromRatio: from.ratio,
    toRatio: to.ratio,
    widenedFor,
    gapChange: best.rise,
    aFromRatio: from.a,
    aToRatio: to.a,
    bFromRatio: from.b,
    bToRatio: to.b,
  }
}

export interface ComparisonWindowInput {
  id: string
  kind: RetentionWindowKind
  fromSeconds: number
  toSeconds: number
  delta: number
  relativePerformance: number | null
}

export interface ComparisonEventInput {
  retentionWindowId: string
  eventType: RetentionWindowEventType
  timestampSeconds: number | null
  narrative: string
  primaryEvidence: RetentionWindowEventPrimaryEvidence | null
  confidence: number | null
}

export function buildComparisonVideo(input: {
  summary: ComparisonVideoSummary
  curve: RetentionPoint[]
  windows: ComparisonWindowInput[]
  events: ComparisonEventInput[]
  readySynthesisWindowIds: ReadonlySet<string>
  calibration: EvidenceCalibration
}): ComparisonVideo {
  const eventsByWindow = new Map<string, ComparisonEvent[]>()
  for (const event of input.events) {
    const built: ComparisonEvent = {
      eventType: event.eventType,
      timestampSeconds: event.timestampSeconds,
      narrative: event.narrative,
      primaryEvidence: event.primaryEvidence,
      confidence: event.confidence,
      weight: eventWeight(input.calibration, event),
    }
    const group = eventsByWindow.get(event.retentionWindowId)
    if (group) group.push(built)
    else eventsByWindow.set(event.retentionWindowId, [built])
  }

  const windows: ComparisonWindow[] = [...input.windows]
    .sort((a, b) => a.fromSeconds - b.fromSeconds)
    .map((window) => ({
      id: window.id,
      kind: window.kind,
      fromSeconds: window.fromSeconds,
      toSeconds: window.toSeconds,
      delta: window.delta,
      relativePerformance: window.relativePerformance,
      deeplyAnalysed: input.readySynthesisWindowIds.has(window.id),
      events: (eventsByWindow.get(window.id) ?? [])
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_EVENTS_PER_WINDOW),
    }))

  const hook = windows.find((window) => window.kind === "hook") ?? null
  const duration = input.summary.durationSeconds
  const hookEndSeconds =
    hook?.toSeconds ?? Math.min(HOOK_FALLBACK_SECONDS, duration || 0)
  const hookHoldRatio =
    duration > 0 ? watchRatioAt(input.curve, hookEndSeconds / duration) : null

  return {
    summary: input.summary,
    curve: [...input.curve].sort((a, b) => a.elapsedRatio - b.elapsedRatio),
    windows,
    hook,
    hookHoldRatio,
    deeplyAnalysedWindowCount: windows.filter(
      (window) => window.deeplyAnalysed,
    ).length,
  }
}

export function buildRetentionComparison(
  a: ComparisonVideo,
  b: ComparisonVideo,
  calibration: EvidenceCalibration,
): RetentionComparisonData {
  return {
    a,
    b,
    divergence: findLargestDivergence(a.curve, b.curve),
    feedbackCount: calibration.feedbackCount,
  }
}

// ---------------------------------------------------------------------------
// Loaders

interface AnalysedVideoRow {
  id: string
  video_title: string | null
  retention: RetentionPoint[] | null
  published_at: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
  analytics_summary: {
    views?: number | null
    averageViewDurationSeconds?: number | null
    averageViewPercentage?: number | null
    subscribersGained?: number | null
    subscribersLost?: number | null
  } | null
}

interface WindowRow {
  id: string
  analysed_video_id: string
  kind: RetentionWindowKind
  from_seconds: number
  to_seconds: number
  delta: number
  relative_performance: number | null
}

interface EventRow {
  retention_window_id: string
  analysed_video_id: string
  event_type: RetentionWindowEventType
  timestamp_seconds: number | null
  narrative: string
  primary_evidence: RetentionWindowEventPrimaryEvidence | null
  confidence: number | null
}

// Bounds on the account-wide calibration queries; feedback volume past this
// stops changing the smoothed rates meaningfully.
const MAX_FEEDBACK_ROWS = 1000

function netSubscribers(
  summary: AnalysedVideoRow["analytics_summary"],
): number | null {
  if (summary?.subscribersGained == null) return null
  return summary.subscribersGained - (summary.subscribersLost ?? 0)
}

function summaryFromRow(row: AnalysedVideoRow): ComparisonVideoSummary {
  const curve = row.retention ?? []
  const lastPoint = curve[curve.length - 1]
  return {
    id: row.id,
    title: row.video_title,
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    // Older rows may predate durationSeconds in video_details; the curve's
    // last sample is a serviceable stand-in for positioning windows.
    durationSeconds:
      row.duration_seconds ?? Math.round(lastPoint?.timestampSeconds ?? 0),
    views: row.analytics_summary?.views ?? null,
    averageViewDurationSeconds:
      row.analytics_summary?.averageViewDurationSeconds ?? null,
    averageViewPercentage:
      row.analytics_summary?.averageViewPercentage ?? null,
    netSubscribersGained: netSubscribers(row.analytics_summary),
  }
}

// The user's account-wide event calibration: every insight rating joined to
// the rated window's events' evidence types - the same mapping
// computeDeepAnalysisQualityMetrics uses, computed from live rows.
async function loadEvidenceCalibration(
  supabase: SupabaseClient,
  userId: string,
): Promise<EvidenceCalibration> {
  const { data: feedbackData, error: feedbackError } = await supabase
    .from("deep_analysis_insight_feedback")
    .select("retention_window_id, rating")
    .eq("user_id", userId)
    .limit(MAX_FEEDBACK_ROWS)

  if (feedbackError) {
    throw new Error(
      `Failed to load insight feedback: ${feedbackError.message}`,
    )
  }

  const feedback = (feedbackData ?? []) as Array<{
    retention_window_id: string
    rating: "helpful" | "not_helpful"
  }>
  if (feedback.length === 0) return computeEvidenceCalibration([])

  const windowIds = [...new Set(feedback.map((row) => row.retention_window_id))]
  const { data: eventData, error: eventError } = await supabase
    .from("retention_window_events")
    .select("retention_window_id, primary_evidence")
    .eq("user_id", userId)
    .in("retention_window_id", windowIds)

  if (eventError) {
    throw new Error(
      `Failed to load events for calibration: ${eventError.message}`,
    )
  }

  const evidenceByWindow = new Map<
    string,
    RetentionWindowEventPrimaryEvidence[]
  >()
  for (const row of (eventData ?? []) as Array<{
    retention_window_id: string
    primary_evidence: RetentionWindowEventPrimaryEvidence | null
  }>) {
    if (row.primary_evidence == null) continue
    const group = evidenceByWindow.get(row.retention_window_id)
    if (group) group.push(row.primary_evidence)
    else evidenceByWindow.set(row.retention_window_id, [row.primary_evidence])
  }

  return computeEvidenceCalibration(
    feedback.flatMap((row) =>
      (evidenceByWindow.get(row.retention_window_id) ?? []).map(
        (primaryEvidence) => ({ rating: row.rating, primaryEvidence }),
      ),
    ),
  )
}

// Loads everything the compare view needs for two videos the user owns.
// Returns null when either video is missing (or belongs to someone else - the
// user-scoped client cannot see it either way).
export async function getRetentionComparison(
  supabase: SupabaseClient,
  userId: string,
  videoIdA: string,
  videoIdB: string,
): Promise<RetentionComparisonData | null> {
  const videoIds = [videoIdA, videoIdB]

  const [videosResult, windowsResult, synthesisResult, eventsResult, calibration] =
    await Promise.all([
      supabase
        .from("analysed_videos")
        .select(
          "id, video_title, retention, analytics_summary, published_at:video_details->>publishedAt, thumbnail_url:video_details->>thumbnailUrl, duration_seconds:video_details->durationSeconds",
        )
        .eq("user_id", userId)
        .in("id", videoIds),
      supabase
        .from("retention_windows")
        .select(
          "id, analysed_video_id, kind, from_seconds, to_seconds, delta, relative_performance",
        )
        .eq("user_id", userId)
        .in("analysed_video_id", videoIds),
      supabase
        .from("retention_window_event_synthesis")
        .select("retention_window_id")
        .eq("user_id", userId)
        .eq("status", "ready")
        .in("analysed_video_id", videoIds),
      supabase
        .from("retention_window_events")
        .select(
          "retention_window_id, analysed_video_id, event_type, timestamp_seconds, narrative, primary_evidence, confidence",
        )
        .eq("user_id", userId)
        .in("analysed_video_id", videoIds),
      loadEvidenceCalibration(supabase, userId),
    ])

  if (videosResult.error) {
    throw new Error(
      `Failed to load comparison videos: ${videosResult.error.message}`,
    )
  }
  if (windowsResult.error) {
    throw new Error(
      `Failed to load comparison windows: ${windowsResult.error.message}`,
    )
  }
  if (synthesisResult.error) {
    throw new Error(
      `Failed to load synthesis status: ${synthesisResult.error.message}`,
    )
  }
  if (eventsResult.error) {
    throw new Error(
      `Failed to load comparison events: ${eventsResult.error.message}`,
    )
  }

  const videoRows = (videosResult.data ?? []) as unknown as AnalysedVideoRow[]
  const rowA = videoRows.find((row) => row.id === videoIdA)
  const rowB = videoRows.find((row) => row.id === videoIdB)
  if (!rowA || !rowB) return null

  const readySynthesisWindowIds = new Set(
    ((synthesisResult.data ?? []) as Array<{ retention_window_id: string }>).map(
      (row) => row.retention_window_id,
    ),
  )

  const buildFor = (row: AnalysedVideoRow): ComparisonVideo =>
    buildComparisonVideo({
      summary: summaryFromRow(row),
      curve: row.retention ?? [],
      windows: ((windowsResult.data ?? []) as unknown as WindowRow[])
        .filter((window) => window.analysed_video_id === row.id)
        .map((window) => ({
          id: window.id,
          kind: window.kind,
          fromSeconds: window.from_seconds,
          toSeconds: window.to_seconds,
          delta: window.delta,
          relativePerformance: window.relative_performance,
        })),
      events: ((eventsResult.data ?? []) as unknown as EventRow[])
        .filter((event) => event.analysed_video_id === row.id)
        .map((event) => ({
          retentionWindowId: event.retention_window_id,
          eventType: event.event_type,
          timestampSeconds: event.timestamp_seconds,
          narrative: event.narrative,
          primaryEvidence: event.primary_evidence,
          confidence: event.confidence,
        })),
      readySynthesisWindowIds,
      calibration,
    })

  return buildRetentionComparison(buildFor(rowA), buildFor(rowB), calibration)
}

// The compare page's picker: every deeply analysed video with a stored
// retention curve, newest analysis first. The comparison rides on the stored
// deep analysis of both videos (curve, windows and their event evidence), so a
// video that was only retention-scanned cannot be compared and never appears
// here. A video counts as deeply analysed once its event synthesis has
// completed for at least one window - the same signal Channel Trends uses to
// grow its library (see loadLibrarySize in lib/channel-trends.ts).
export async function listComparableVideos(
  supabase: SupabaseClient,
  userId: string,
): Promise<ComparableVideo[]> {
  const { data: synthesisData, error: synthesisError } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (synthesisError) {
    throw new Error(
      `Failed to load deeply analysed videos: ${synthesisError.message}`,
    )
  }

  const deeplyAnalysedIds = [
    ...new Set(
      (
        (synthesisData ?? []) as Array<{ analysed_video_id: string }>
      ).map((row) => row.analysed_video_id),
    ),
  ]
  if (deeplyAnalysedIds.length === 0) return []

  const { data, error } = await supabase
    .from("analysed_videos")
    .select(
      "id, video_title, date_analysed, average_view_percentage:analytics_summary->averageViewPercentage",
    )
    .eq("user_id", userId)
    .in("id", deeplyAnalysedIds)
    .not("retention", "is", null)
    .order("date_analysed", { ascending: false })
    .limit(100)

  if (error) {
    throw new Error(`Failed to load comparable videos: ${error.message}`)
  }

  return (
    (data ?? []) as unknown as Array<{
      id: string
      video_title: string | null
      date_analysed: string | null
      average_view_percentage: number | null
    }>
  ).map((row) => ({
    id: row.id,
    title: row.video_title,
    dateAnalysed: row.date_analysed,
    averageViewPercentage: row.average_view_percentage,
  }))
}

// The default head-to-head: the strongest and weakest average-watched videos
// (the same metric the comparison explains), falling back to the two most
// recent analyses when analytics have not landed yet. Null when the library
// has fewer than two comparable videos.
export function defaultComparisonPair(
  videos: ComparableVideo[],
): { a: string; b: string } | null {
  if (videos.length < 2) return null
  const withMetric = videos.filter(
    (video) => video.averageViewPercentage != null,
  )
  if (withMetric.length >= 2) {
    const sorted = [...withMetric].sort(
      (a, b) =>
        (b.averageViewPercentage ?? 0) - (a.averageViewPercentage ?? 0),
    )
    return { a: sorted[0].id, b: sorted[sorted.length - 1].id }
  }
  return { a: videos[0].id, b: videos[1].id }
}
