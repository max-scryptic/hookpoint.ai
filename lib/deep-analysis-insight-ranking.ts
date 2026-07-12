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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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
  window: Pick<PersistedRetentionWindow, "delta" | "steepness">
  evidence: InsightRankingEvidence
  minimumScore?: number
  maxInsights?: number
}): RankedRetentionWindowEvent[] {
  return evaluateRetentionWindowInsights(params).ranked
}

export function evaluateRetentionWindowInsights(params: {
  events: RetentionWindowEvent[]
  window: Pick<PersistedRetentionWindow, "delta" | "steepness">
  evidence: InsightRankingEvidence
  minimumScore?: number
  maxInsights?: number
}): {
  ranked: RankedRetentionWindowEvent[]
  suppressed: SuppressedRetentionWindowEvent[]
} {
  const evidenceCompleteness = availableEvidenceCount(params.evidence) / 4
  const retentionSignificance = clamp01(Math.abs(params.window.delta) / 0.08)
  const steepness = clamp01(Math.abs(params.window.steepness ?? 0) / 3)

  const scored = params.events.map((event) => {
    const modelConfidence = event.confidence ?? 0.45
    const primarySupported = supportsPrimaryEvidence(event, params.evidence)
    const isCombined = event.primaryEvidence === "combined"
    let score =
      modelConfidence * 0.55 +
      retentionSignificance * 0.2 +
      evidenceCompleteness * 0.15 +
      steepness * 0.1
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
