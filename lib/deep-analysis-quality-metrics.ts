import type { SupabaseClient } from "@supabase/supabase-js"

export interface DeepAnalysisQualityMetrics {
  feedbackCount: number
  helpfulCount: number
  helpfulRate: number | null
  totalInsightsShown: number
  totalInsightsSuppressed: number
  suppressionRate: number | null
  recommendationCoverage: number | null
  totalLlmCostUsd: number
  costPerHelpfulInsightUsd: number | null
  helpfulByEvidence: Record<string, { helpful: number; total: number }>
  notHelpfulByReason: Record<string, number>
}

interface FeedbackMetricRow {
  rating: "helpful" | "not_helpful"
  reason: string | null
  evaluated_payload: {
    events?: Array<{ primaryEvidence?: string }>
    recommendations?: unknown[]
    suppression?: unknown[]
    cost?: { llmUsd?: number }
  } | null
}

export function computeDeepAnalysisQualityMetrics(
  rows: FeedbackMetricRow[],
): DeepAnalysisQualityMetrics {
  let helpfulCount = 0
  let totalInsightsShown = 0
  let totalInsightsSuppressed = 0
  let windowsWithRecommendation = 0
  let totalLlmCostUsd = 0
  const helpfulByEvidence: Record<string, { helpful: number; total: number }> = {}
  const notHelpfulByReason: Record<string, number> = {}

  for (const row of rows) {
    if (row.rating === "helpful") helpfulCount++
    else if (row.reason) {
      notHelpfulByReason[row.reason] = (notHelpfulByReason[row.reason] ?? 0) + 1
    }
    const payload = row.evaluated_payload ?? {}
    const events = payload.events ?? []
    totalInsightsShown += events.length
    totalInsightsSuppressed += payload.suppression?.length ?? 0
    if ((payload.recommendations?.length ?? 0) > 0) windowsWithRecommendation++
    totalLlmCostUsd += Number(payload.cost?.llmUsd ?? 0) || 0
    for (const event of events) {
      const evidence = event.primaryEvidence ?? "unknown"
      const metric = (helpfulByEvidence[evidence] ??= { helpful: 0, total: 0 })
      metric.total++
      if (row.rating === "helpful") metric.helpful++
    }
  }

  const totalCandidates = totalInsightsShown + totalInsightsSuppressed
  return {
    feedbackCount: rows.length,
    helpfulCount,
    helpfulRate: rows.length > 0 ? helpfulCount / rows.length : null,
    totalInsightsShown,
    totalInsightsSuppressed,
    suppressionRate:
      totalCandidates > 0 ? totalInsightsSuppressed / totalCandidates : null,
    recommendationCoverage:
      rows.length > 0 ? windowsWithRecommendation / rows.length : null,
    totalLlmCostUsd,
    costPerHelpfulInsightUsd:
      helpfulCount > 0 ? totalLlmCostUsd / helpfulCount : null,
    helpfulByEvidence,
    notHelpfulByReason,
  }
}

export async function getDeepAnalysisQualityMetrics(
  supabase: SupabaseClient,
  userId: string,
): Promise<DeepAnalysisQualityMetrics> {
  const { data, error } = await supabase
    .from("deep_analysis_insight_feedback")
    .select("rating, reason, evaluated_payload")
    .eq("user_id", userId)
  if (error) throw new Error(`Failed to load deep analysis quality metrics: ${error.message}`)
  return computeDeepAnalysisQualityMetrics((data ?? []) as FeedbackMetricRow[])
}
