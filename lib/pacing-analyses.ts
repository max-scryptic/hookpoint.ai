import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  PacingAnalysis,
  PacingWindow,
} from "@/lib/pacing-analysis"

interface PacingAnalysisRow {
  id: string
  model: string
  overall_pacing: string
  video_wide_patterns: string[]
  notable_transitions: PacingAnalysis["notableTransitions"]
  slow_or_repetitive_stretches: PacingAnalysis["slowOrRepetitiveStretches"]
  generated_at: string
}

interface PacingWindowRow {
  window_index: number
  kind: PacingWindow["kind"]
  label: string
  start_seconds: number
  end_seconds: number
  word_count: number
  words_per_minute: number
  role: string
  pace: PacingWindow["pace"]
  information_density: PacingWindow["informationDensity"]
  progression: PacingWindow["progression"]
  pacing_change: PacingWindow["pacingChange"]
  evidence: string[]
  possible_issue: string | null
  confidence: number
}

const ANALYSIS_COLUMNS =
  "id, model, overall_pacing, video_wide_patterns, notable_transitions, slow_or_repetitive_stretches, generated_at"
const WINDOW_COLUMNS =
  "window_index, kind, label, start_seconds, end_seconds, word_count, words_per_minute, role, pace, information_density, progression, pacing_change, evidence, possible_issue, confidence"

export async function getPacingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<PacingAnalysis | null> {
  const { data: analysisData, error: analysisError } = await supabase
    .from("pacing_analyses")
    .select(ANALYSIS_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .maybeSingle()

  if (analysisError) {
    throw new Error(`Failed to load pacing analysis: ${analysisError.message}`)
  }
  if (!analysisData) return null

  const analysis = analysisData as PacingAnalysisRow
  const { data: windowData, error: windowError } = await supabase
    .from("pacing_windows")
    .select(WINDOW_COLUMNS)
    .eq("user_id", userId)
    .eq("pacing_analysis_id", analysis.id)
    .order("window_index", { ascending: true })

  if (windowError) {
    throw new Error(`Failed to load pacing windows: ${windowError.message}`)
  }

  const windows = ((windowData ?? []) as PacingWindowRow[]).map(
    (window): PacingWindow => ({
      id: window.kind === "hook" ? "hook" : `minute-${window.window_index}`,
      label: window.label,
      kind: window.kind,
      startSeconds: window.start_seconds,
      endSeconds: window.end_seconds,
      wordCount: window.word_count,
      wordsPerMinute: window.words_per_minute,
      role: window.role,
      pace: window.pace,
      informationDensity: window.information_density,
      progression: window.progression,
      pacingChange: window.pacing_change,
      evidence: window.evidence,
      possibleIssue: window.possible_issue,
      confidence: window.confidence,
    }),
  )

  return {
    overallPacing: analysis.overall_pacing,
    videoWidePatterns: analysis.video_wide_patterns,
    notableTransitions: analysis.notable_transitions,
    slowOrRepetitiveStretches: analysis.slow_or_repetitive_stretches,
    windows,
    model: analysis.model,
    generatedAt: analysis.generated_at,
  }
}

export async function savePacingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  pacingAnalysis: PacingAnalysis,
): Promise<void> {
  const { data: analysisData, error: analysisError } = await supabase
    .from("pacing_analyses")
    .upsert(
      {
        analysed_video_id: analysedVideoId,
        user_id: userId,
        model: pacingAnalysis.model,
        prompt_version: "v1",
        overall_pacing: pacingAnalysis.overallPacing,
        video_wide_patterns: pacingAnalysis.videoWidePatterns,
        notable_transitions: pacingAnalysis.notableTransitions,
        slow_or_repetitive_stretches:
          pacingAnalysis.slowOrRepetitiveStretches,
        generated_at: pacingAnalysis.generatedAt,
      },
      { onConflict: "analysed_video_id" },
    )
    .select("id")
    .single()

  if (analysisError || !analysisData) {
    throw new Error(
      `Failed to save pacing analysis: ${analysisError?.message ?? "no row returned"}`,
    )
  }

  const pacingAnalysisId = (analysisData as { id: string }).id
  const windowRows = pacingAnalysis.windows.map((window, windowIndex) => ({
    pacing_analysis_id: pacingAnalysisId,
    user_id: userId,
    window_index: windowIndex,
    kind: window.kind,
    label: window.label,
    start_seconds: window.startSeconds,
    end_seconds: window.endSeconds,
    word_count: window.wordCount,
    words_per_minute: window.wordsPerMinute,
    role: window.role,
    pace: window.pace,
    information_density: window.informationDensity,
    progression: window.progression,
    pacing_change: window.pacingChange,
    evidence: window.evidence,
    possible_issue: window.possibleIssue,
    confidence: window.confidence,
  }))

  const { error: windowsError } = await supabase
    .from("pacing_windows")
    .upsert(windowRows, { onConflict: "pacing_analysis_id,window_index" })

  if (windowsError) {
    throw new Error(`Failed to save pacing windows: ${windowsError.message}`)
  }

  // A regenerated report can contain fewer windows if the source duration was
  // corrected. Remove only stale trailing rows after the replacement succeeds.
  const { error: staleWindowsError } = await supabase
    .from("pacing_windows")
    .delete()
    .eq("user_id", userId)
    .eq("pacing_analysis_id", pacingAnalysisId)
    .gte("window_index", windowRows.length)

  if (staleWindowsError) {
    throw new Error(
      `Failed to remove stale pacing windows: ${staleWindowsError.message}`,
    )
  }
}
