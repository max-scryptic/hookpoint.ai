function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function getDeepAnalysisMinimumInsightScore(): number {
  return boundedNumber("DEEP_ANALYSIS_MIN_INSIGHT_SCORE", 0.48, 0, 1)
}

export function getDeepAnalysisMaxInsightsPerWindow(): number {
  return Math.round(boundedNumber("DEEP_ANALYSIS_MAX_INSIGHTS_PER_WINDOW", 3, 1, 10))
}

export function getDeepAnalysisMaxRecommendationsPerWindow(): number {
  return Math.round(
    boundedNumber("DEEP_ANALYSIS_MAX_RECOMMENDATIONS_PER_WINDOW", 2, 0, 5),
  )
}

function enabled(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return fallback
  return !["0", "false", "off", "no"].includes(value)
}

function stableBucket(subject: string): number {
  let hash = 2166136261
  for (let index = 0; index < subject.length; index++) {
    hash ^= subject.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 100
}

export interface DeepAnalysisRollout {
  insights: boolean
  recommendations: boolean
  evidencePanel: boolean
}

export function getDeepAnalysisRollout(subjectId: string): DeepAnalysisRollout {
  const percentage = boundedNumber("DEEP_ANALYSIS_ROLLOUT_PERCENT", 100, 0, 100)
  const included = stableBucket(subjectId) < percentage
  const insights = included && enabled("DEEP_ANALYSIS_INSIGHTS_ENABLED", true)
  return {
    insights,
    recommendations:
      insights && enabled("DEEP_ANALYSIS_RECOMMENDATIONS_ENABLED", true),
    evidencePanel:
      included && enabled("DEEP_ANALYSIS_EVIDENCE_PANEL_ENABLED", true),
  }
}
