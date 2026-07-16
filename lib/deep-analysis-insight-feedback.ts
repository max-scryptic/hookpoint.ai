import type { SupabaseClient } from "@supabase/supabase-js"

export const DEEP_ANALYSIS_PIPELINE_VERSION = "retention-events-v2-calibrated"

export const DEEP_ANALYSIS_FEEDBACK_RATINGS = [
  "helpful",
  "not_helpful",
] as const

export type DeepAnalysisFeedbackRating =
  (typeof DEEP_ANALYSIS_FEEDBACK_RATINGS)[number]

export const DEEP_ANALYSIS_FEEDBACK_REASONS = [
  "incorrect",
  "too_generic",
  "not_actionable",
  "already_known",
  "other",
] as const

export type DeepAnalysisFeedbackReason =
  (typeof DEEP_ANALYSIS_FEEDBACK_REASONS)[number]

export interface DeepAnalysisInsightFeedback {
  rating: DeepAnalysisFeedbackRating
  reason: DeepAnalysisFeedbackReason | null
  notes: string | null
}

interface FeedbackRow {
  retention_window_id: string
  rating: DeepAnalysisFeedbackRating
  reason: DeepAnalysisFeedbackReason | null
  notes: string | null
}

export function isDeepAnalysisFeedbackRating(
  value: unknown,
): value is DeepAnalysisFeedbackRating {
  return DEEP_ANALYSIS_FEEDBACK_RATINGS.includes(
    value as DeepAnalysisFeedbackRating,
  )
}

export function isDeepAnalysisFeedbackReason(
  value: unknown,
): value is DeepAnalysisFeedbackReason {
  return DEEP_ANALYSIS_FEEDBACK_REASONS.includes(
    value as DeepAnalysisFeedbackReason,
  )
}

export async function getDeepAnalysisInsightFeedbackForVideo(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<Map<string, DeepAnalysisInsightFeedback>> {
  const { data, error } = await supabase
    .from("deep_analysis_insight_feedback")
    .select("retention_window_id, rating, reason, notes")
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)

  if (error) {
    throw new Error(`Failed to load deep analysis feedback: ${error.message}`)
  }

  return new Map(
    ((data ?? []) as FeedbackRow[]).map((row) => [
      row.retention_window_id,
      { rating: row.rating, reason: row.reason, notes: row.notes },
    ]),
  )
}
