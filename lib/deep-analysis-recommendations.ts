import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { AudioAnalysis } from "@/lib/retention-window-media-analysis"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import type { SceneCueMetrics } from "@/lib/video-scene-cues"

export type RecommendationActionType =
  | "trim_silence"
  | "replace_freeze"
  | "remove_black_frame"
  | "increase_visual_pacing"
  | "reduce_visual_pacing"
  | "adjust_delivery"
  | "add_visual_support"
  | "preserve_pattern"
  | "review_transition"

export interface DeepAnalysisRecommendation {
  id: string
  sourceEventId: string
  timestampSeconds: number
  actionType: RecommendationActionType
  action: string
  rationale: string
  expectedPurpose: string
  evidenceQuality: RankedRetentionWindowEvent["evidenceQuality"]
  insightScore: number
}

export interface RecommendationBaseline {
  cutsPerMinute: number | null
  speechRate: number | null
}

function recommendationForEvent(params: {
  event: RankedRetentionWindowEvent
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
}): Omit<DeepAnalysisRecommendation, "id" | "sourceEventId" | "timestampSeconds" | "evidenceQuality" | "insightScore"> {
  const { event, window, editing, baseline, audio } = params
  const isGain = window.kind === "gain"

  if (isGain) {
    return {
      actionType: "preserve_pattern",
      action:
        "Mark this moment as a pattern to reuse in the next edit, preserving its delivery, visual change, and transition timing.",
      rationale: event.narrative,
      expectedPurpose:
        "Test whether repeating the same proven pattern helps create another retention gain.",
    }
  }

  if (editing && editing.freezeCoverage >= 0.05) {
    return {
      actionType: "replace_freeze",
      action:
        "Shorten the frozen section or cover it with relevant B-roll, a close-up, or a supporting graphic.",
      rationale: event.narrative,
      expectedPurpose: "Keep the picture advancing while the point is delivered.",
    }
  }
  if (editing && editing.blackCoverage >= 0.05) {
    return {
      actionType: "remove_black_frame",
      action:
        "Tighten the black-frame transition or replace it with a continuous visual bridge.",
      rationale: event.narrative,
      expectedPurpose: "Test a smoother transition with less visual interruption.",
    }
  }
  if (audio?.silence != null && audio.silence >= 0.1) {
    return {
      actionType: "trim_silence",
      action:
        "Trim the measurable dead air here, while retaining a short natural pause if the sentence needs it.",
      rationale: event.narrative,
      expectedPurpose: "Test whether a tighter audio transition sustains momentum.",
    }
  }

  if (
    audio?.speech_rate != null &&
    baseline.speechRate != null &&
    baseline.speechRate > 0
  ) {
    const ratio = audio.speech_rate / baseline.speechRate
    if (ratio <= 0.8 || ratio >= 1.25) {
      return {
        actionType: "adjust_delivery",
        action:
          ratio <= 0.8
            ? "Tighten the delivery toward the video's usual speaking pace, or shorten this explanation."
            : "Give the key point slightly more room, or simplify the wording so it remains easy to follow.",
        rationale: event.narrative,
        expectedPurpose: "Test a delivery pace closer to the video's established norm.",
      }
    }
  }

  if (
    editing?.cutsPerMinute != null &&
    baseline.cutsPerMinute != null &&
    baseline.cutsPerMinute > 0
  ) {
    const ratio = editing.cutsPerMinute / baseline.cutsPerMinute
    if (ratio <= 0.7) {
      return {
        actionType: "increase_visual_pacing",
        action:
          "Add one purposeful visual change here, such as B-roll, a crop change, a demonstration, or concise on-screen text.",
        rationale: event.narrative,
        expectedPurpose: "Test pacing closer to the rest of the video without adding noise.",
      }
    }
    if (ratio >= 1.4) {
      return {
        actionType: "reduce_visual_pacing",
        action:
          "Remove a non-essential cut or let the most informative shot remain long enough to register.",
        rationale: event.narrative,
        expectedPurpose: "Test whether clearer visual continuity improves comprehension.",
      }
    }
  }

  if (event.primaryEvidence === "visual" || event.eventType === "visual_change") {
    return {
      actionType: "add_visual_support",
      action:
        "Test an alternative visual treatment at this timestamp, using a relevant demonstration, graphic, or framing change.",
      rationale: event.narrative,
      expectedPurpose: "Give the spoken point clearer visual support.",
    }
  }

  return {
    actionType: "review_transition",
    action:
      "Create an alternate cut of this transition and compare a shorter, more direct version against the current edit.",
    rationale: event.narrative,
    expectedPurpose: "Turn the observed retention signal into a testable editing decision.",
  }
}

export function compileDeepAnalysisRecommendations(params: {
  events: RankedRetentionWindowEvent[]
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
  maxRecommendations?: number
}): DeepAnalysisRecommendation[] {
  return params.events.slice(0, params.maxRecommendations ?? 2).map((event) => ({
    id: `${params.window.id}:${event.id}`,
    sourceEventId: event.id,
    timestampSeconds: event.timestampSeconds,
    evidenceQuality: event.evidenceQuality,
    insightScore: event.insightScore,
    ...recommendationForEvent({ ...params, event }),
  }))
}

// Nearby windows can overlap and produce the same edit instruction. Keep the
// stronger recommendation so creators do not see repeated advice in adjacent
// cards or tabs.
export function dedupeDeepAnalysisRecommendations(
  groups: DeepAnalysisRecommendation[][],
): void {
  const ordered = groups
    .flatMap((recommendations, groupIndex) =>
      recommendations.map((recommendation) => ({ recommendation, groupIndex })),
    )
    .sort((a, b) => b.recommendation.insightScore - a.recommendation.insightScore)
  const kept: DeepAnalysisRecommendation[] = []
  const keepIds = new Set<string>()
  for (const { recommendation } of ordered) {
    const duplicate = kept.some(
      (existing) =>
        existing.actionType === recommendation.actionType &&
        Math.abs(existing.timestampSeconds - recommendation.timestampSeconds) <= 20,
    )
    if (!duplicate) {
      kept.push(recommendation)
      keepIds.add(recommendation.id)
    }
  }
  for (const recommendations of groups) {
    recommendations.splice(
      0,
      recommendations.length,
      ...recommendations.filter((recommendation) => keepIds.has(recommendation.id)),
    )
  }
}
