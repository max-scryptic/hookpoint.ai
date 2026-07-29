// Turns each ranked retention-window event into one concrete recommendation.
//
// COPY CONSTRAINT: the video being analysed is already published on YouTube.
// Its edit cannot be changed, and there is no way to put an alternate cut up
// against the live one, so a recommendation phrased as "re-cut this and compare
// it against the current edit" asks for something impossible. Every action here
// must read as guidance the uploader applies to the videos they make next:
// prefer "in future videos ..." / "next time ..." over "trim this" or "test an
// alternate cut of this". The timestamp stays in the recommendation because it
// says which moment taught the lesson, not which frames to go and change.

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
  | "signpost_topic_shift"
  | "preserve_pattern"
  | "review_transition"

export interface DeepAnalysisRecommendation {
  id: string
  sourceEventId: string
  timestampSeconds: number
  actionType: RecommendationActionType
  // The forward-looking instruction shown to the uploader as the "Try:" line.
  // Always about their next videos, never about re-editing this one.
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
        "Treat this as a pattern to repeat: when you reach a comparable beat in your next videos, use the same delivery, visual change, and transition timing you used here.",
      rationale: event.narrative,
      expectedPurpose:
        "Repeating a proven pattern deliberately is what turns one gain into a habit.",
    }
  }

  if (editing && editing.freezeCoverage >= 0.05) {
    return {
      actionType: "replace_freeze",
      action:
        "In future videos, keep the picture moving through a stretch like this: plan relevant B-roll, a close-up, or a supporting graphic to cover it rather than letting the frame hold.",
      rationale: event.narrative,
      expectedPurpose: "Keeps the picture advancing while the point is delivered.",
    }
  }
  if (editing && editing.blackCoverage >= 0.05) {
    return {
      actionType: "remove_black_frame",
      action:
        "In future videos, bridge a transition like this with a continuous visual instead of cutting to black, or hold the black for only a few frames.",
      rationale: event.narrative,
      expectedPurpose: "A smoother transition gives viewers less of a cue to leave.",
    }
  }
  if (audio?.silence != null && audio.silence >= 0.1) {
    return {
      actionType: "trim_silence",
      action:
        "In future videos, cut dead air like this out in the edit, keeping only the short pause a sentence genuinely needs.",
      rationale: event.narrative,
      expectedPurpose: "A tighter audio transition sustains momentum through the point.",
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
            ? "When you explain something like this in future videos, keep the delivery closer to your usual speaking pace, or plan a shorter version of the explanation."
            : "When you land a key point like this in future videos, give it slightly more room, or simplify the wording so it stays easy to follow at speed.",
        rationale: event.narrative,
        expectedPurpose:
          "A pace closer to your established norm is what viewers arrive expecting.",
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
          "In future videos, plan at least one purposeful visual change for a stretch like this: B-roll, a crop change, a demonstration, or concise on-screen text.",
        rationale: event.narrative,
        expectedPurpose: "Pacing closer to the rest of the video, without adding noise.",
      }
    }
    if (ratio >= 1.4) {
      return {
        actionType: "reduce_visual_pacing",
        action:
          "In future videos, cut less through a stretch like this: leave out the non-essential cuts and let the most informative shot stay on screen long enough to register.",
        rationale: event.narrative,
        expectedPurpose: "Clearer visual continuity is easier to follow.",
      }
    }
  }

  // Structure, not craft: a topic shift needs setup in the script, so the advice
  // belongs to how the next video is written rather than to any edit decision.
  if (event.eventType === "topic_shift") {
    return {
      actionType: "signpost_topic_shift",
      action:
        "In future videos, signpost a shift like this before you make it: say what is coming and why it matters to what viewers came for, then keep the new section short and tie it back to the main topic.",
      rationale: event.narrative,
      expectedPurpose:
        "A signposted shift reads as part of the promise instead of a different video.",
    }
  }

  if (event.primaryEvidence === "visual" || event.eventType === "visual_change") {
    return {
      actionType: "add_visual_support",
      action:
        "In future videos, give a spoken point like this something to look at as you make it: a relevant demonstration, graphic, or framing change.",
      rationale: event.narrative,
      expectedPurpose: "Gives the spoken point clearer visual support.",
    }
  }

  return {
    actionType: "review_transition",
    action:
      "In future videos, get through a transition like this faster: move straight into the next point rather than talking your way into it.",
    rationale: event.narrative,
    expectedPurpose:
      "Turns the retention signal at this moment into an editing habit for the next video.",
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
