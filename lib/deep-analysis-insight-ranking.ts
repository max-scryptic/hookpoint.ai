import type { RetentionWindowEvent } from "@/lib/retention-window-events"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

export type InsightEvidenceQuality = "high" | "medium"

export interface RankedRetentionWindowEvent extends RetentionWindowEvent {
  insightScore: number
  evidenceCompleteness: number
  evidenceQuality: InsightEvidenceQuality
  insightRank: number
}

export type InsightSuppressionReason =
  | "below_score_threshold"
  | "duplicate"
  | "window_limit"

export interface SuppressedRetentionWindowEvent {
  event: RetentionWindowEvent
  insightScore: number
  reason: InsightSuppressionReason
}

export interface InsightRankingEvidence {
  hasEditing: boolean
  hasVisual: boolean
  hasAudio: boolean
  hasTranscript: boolean
}

const CAUSAL_LANGUAGE = /\b(caused?|drove|led to|made (?:viewers|people)|resulted in|because of|explains? (?:the|this))\b/i

// The share of an event's score that comes from the window it sits in rather
// than from the event itself, split between how big the retention move was and
// how sharply it happened.
const RETENTION_SHARE = 0.2
const STEEPNESS_SHARE = 0.1

// A drop or gain of this size is as notable as the scoring cares to measure.
const FULL_CREDIT_DELTA = 0.08
const FULL_CREDIT_STEEPNESS = 3

// A hold running this long is carrying the audience on its own rather than
// coasting on the moment before it. detectRetentionHolds needs 10s to record one
// at all, so this is roughly four times the shortest hold that exists.
const FULL_CREDIT_HOLD_SECONDS = 45

// What a hold with no comparative figure is worth: ordinary for its slot, which
// is neither a reason to promote its events nor a reason to bury them.
const ASSUMED_HOLD_PERFORMANCE = 0.5

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// What the ranker needs to know about the window an event was found in.
export type InsightRankingWindow = Pick<
  PersistedRetentionWindow,
  | "kind"
  | "delta"
  | "steepness"
  | "fromSeconds"
  | "toSeconds"
  | "relativePerformance"
>

// How much the window's own retention behaviour adds to an event's score,
// already weighted: RETENTION_SHARE + STEEPNESS_SHARE at most, for every kind of
// window.
//
// WHY A HOLD IS MEASURED DIFFERENTLY
//
// For a drop-off or a gain the signal is the size of the move and how abruptly
// it happened, so the delta and the steepness are the measurement. A hold is
// defined by the absence of a move: detectRetentionHolds only keeps a stretch
// whose net change stays under 1.5% inside a 2.5% band, and it records no
// steepness at all. Scored on those two numbers a hold forfeits this entire
// share of the score, and it forfeits it for being a hold rather than for
// having weak evidence.
//
// That is why holds reached the page carrying an explanation and no tip. Their
// events sat at the floor, most fell under the minimum insight score and were
// suppressed, and a recommendation is only ever compiled from an event that
// survived - so the section that should say "here is what kept them watching,
// do it again on purpose" said nothing at all.
//
// So a hold is scored on what actually makes one worth reading: how long the
// audience stayed put, and how that stretch compares against similar videos.
// Both answer the same question the delta answers elsewhere, which is how much
// this moment has to teach.
function windowScoreContribution(window: InsightRankingWindow): number {
  if (window.kind === "hold") {
    const seconds = Math.max(0, window.toSeconds - window.fromSeconds)
    const duration = clamp01(seconds / FULL_CREDIT_HOLD_SECONDS)
    const comparative = clamp01(
      window.relativePerformance ?? ASSUMED_HOLD_PERFORMANCE,
    )
    return (
      (RETENTION_SHARE + STEEPNESS_SHARE) *
      clamp01(duration * 0.6 + comparative * 0.4)
    )
  }

  return (
    RETENTION_SHARE * clamp01(Math.abs(window.delta) / FULL_CREDIT_DELTA) +
    STEEPNESS_SHARE *
      clamp01(Math.abs(window.steepness ?? 0) / FULL_CREDIT_STEEPNESS)
  )
}

function availableEvidenceCount(evidence: InsightRankingEvidence): number {
  return [
    evidence.hasEditing,
    evidence.hasVisual,
    evidence.hasAudio,
    evidence.hasTranscript,
  ].filter(Boolean).length
}

function supportsPrimaryEvidence(
  event: RetentionWindowEvent,
  evidence: InsightRankingEvidence,
): boolean {
  if (event.primaryEvidence === "combined") return availableEvidenceCount(evidence) >= 2
  if (event.primaryEvidence === "editing") return evidence.hasEditing
  if (event.primaryEvidence === "visual") return evidence.hasVisual
  if (event.primaryEvidence === "audio") return evidence.hasAudio
  return evidence.hasTranscript
}

function narrativeTokens(narrative: string): Set<string> {
  return new Set(
    narrative
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  )
}

function narrativeSimilarity(a: string, b: string): number {
  const left = narrativeTokens(a)
  const right = narrativeTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection++
  return intersection / new Set([...left, ...right]).size
}

function eventsDuplicate(a: RetentionWindowEvent, b: RetentionWindowEvent): boolean {
  return (
    (a.eventType === b.eventType &&
      Math.abs(a.timestampSeconds - b.timestampSeconds) <= 5) ||
    narrativeSimilarity(a.narrative, b.narrative) >= 0.55
  )
}

export function rankRetentionWindowInsights(params: {
  events: RetentionWindowEvent[]
  window: InsightRankingWindow
  evidence: InsightRankingEvidence
  minimumScore?: number
  maxInsights?: number
}): RankedRetentionWindowEvent[] {
  return evaluateRetentionWindowInsights(params).ranked
}

export function evaluateRetentionWindowInsights(params: {
  events: RetentionWindowEvent[]
  window: InsightRankingWindow
  evidence: InsightRankingEvidence
  minimumScore?: number
  maxInsights?: number
}): {
  ranked: RankedRetentionWindowEvent[]
  suppressed: SuppressedRetentionWindowEvent[]
} {
  const evidenceCompleteness = availableEvidenceCount(params.evidence) / 4
  const windowSignificance = windowScoreContribution(params.window)

  const scored = params.events.map((event) => {
    const modelConfidence = event.confidence ?? 0.45
    const primarySupported = supportsPrimaryEvidence(event, params.evidence)
    const isCombined = event.primaryEvidence === "combined"
    let score =
      modelConfidence * 0.55 +
      windowSignificance +
      evidenceCompleteness * 0.15
    if (isCombined && primarySupported) score += 0.05
    if (!primarySupported) score -= 0.25
    // A single-modality event may report an observation, but strong causal
    // wording needs corroboration. Penalising it suppresses overclaims while
    // still allowing a precise, measured observation through.
    if (!isCombined && CAUSAL_LANGUAGE.test(event.narrative)) score -= 0.12
    score = clamp01(score)
    return { event, score }
  })

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.event.timestampSeconds - b.event.timestampSeconds,
  )

  const kept: Array<{ event: RetentionWindowEvent; score: number }> = []
  const suppressed: SuppressedRetentionWindowEvent[] = []
  for (const candidate of scored) {
    if (candidate.score < (params.minimumScore ?? 0.48)) {
      suppressed.push({ ...candidate, insightScore: candidate.score, reason: "below_score_threshold" })
      continue
    }
    if (kept.some((existing) => eventsDuplicate(candidate.event, existing.event))) {
      suppressed.push({ ...candidate, insightScore: candidate.score, reason: "duplicate" })
      continue
    }
    if (kept.length >= (params.maxInsights ?? 3)) {
      suppressed.push({ ...candidate, insightScore: candidate.score, reason: "window_limit" })
      continue
    }
    kept.push(candidate)
  }

  return {
    ranked: kept.map(({ event, score }, index) => ({
      ...event,
      insightScore: score,
      evidenceCompleteness,
      evidenceQuality:
        score >= 0.72 && evidenceCompleteness >= 0.5 ? "high" : "medium",
      insightRank: index + 1,
    })),
    suppressed,
  }
}

export function assignGlobalInsightRanks(
  groups: RankedRetentionWindowEvent[][],
): void {
  const ordered = groups.flat().sort((a, b) => b.insightScore - a.insightScore)
  ordered.forEach((event, index) => {
    event.insightRank = index + 1
  })
}
