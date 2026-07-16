import type { PersistedRetentionWindow } from "@/lib/retention-windows"

// Prioritises expected creator value per paid deep-analysis window. Drop-offs
// combine audience impact with abnormal steepness and comparative
// underperformance. Gains use cumulative replay/return magnitude. Holds reward
// duration, flatness and comparative performance. Hooks are mandatory and
// handled separately by the selector.
export function deepAnalysisPriorityScore(
  window: PersistedRetentionWindow,
): number {
  const impact = Math.abs(window.delta)
  if (window.kind === "drop_off") {
    const steepness = Math.max(1, window.steepness ?? 1)
    const comparativeBoost =
      window.relativePerformance != null && window.relativePerformance < 0.5
        ? 1.25
        : 1
    return impact * steepness * comparativeBoost
  }
  if (window.kind === "gain") return impact
  if (window.kind === "hold") {
    const duration = Math.max(1, window.toSeconds - window.fromSeconds)
    const durationBoost = Math.min(2, duration / 30)
    const flatness = Math.max(0, 0.02 - impact)
    const comparativeBoost =
      window.relativePerformance == null
        ? 1
        : 0.75 + Math.min(1, Math.max(0, window.relativePerformance))
    return flatness * durationBoost * comparativeBoost
  }
  return Number.POSITIVE_INFINITY
}

// Selects the bounded set that receives extraction + vision + audio + event
// synthesis. Light analysis still retains every window. The opening hook is
// always kept; when capacity allows, at least the strongest drop and strongest
// gain and hold are reserved before remaining slots are filled by score.
export function selectDeepAnalysisWindows(
  windows: PersistedRetentionWindow[],
  maxWindows: number,
): PersistedRetentionWindow[] {
  const eligible = windows.filter(
    (window) =>
      window.analysisFromSeconds != null && window.analysisToSeconds != null,
  )
  if (!Number.isFinite(maxWindows) || eligible.length <= maxWindows) {
    return eligible
  }
  if (maxWindows <= 0) return []

  const originalOrder = new Map(windows.map((window, index) => [window.id, index]))
  const selected = new Map<string, PersistedRetentionWindow>()
  const ranked = (kind: "drop_off" | "gain" | "hold") =>
    eligible
      .filter((window) => window.kind === kind)
      .sort((a, b) => deepAnalysisPriorityScore(b) - deepAnalysisPriorityScore(a))

  for (const hook of eligible.filter((window) => window.kind === "hook")) {
    if (selected.size >= maxWindows) break
    selected.set(hook.id, hook)
  }

  for (const candidate of [
    ranked("drop_off")[0],
    ranked("gain")[0],
    ranked("hold")[0],
  ]) {
    if (!candidate || selected.size >= maxWindows) continue
    selected.set(candidate.id, candidate)
  }

  const remaining = eligible
    .filter((window) => !selected.has(window.id))
    .sort((a, b) => deepAnalysisPriorityScore(b) - deepAnalysisPriorityScore(a))
  for (const window of remaining) {
    if (selected.size >= maxWindows) break
    selected.set(window.id, window)
  }

  return [...selected.values()].sort(
    (a, b) =>
      (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0),
  )
}
