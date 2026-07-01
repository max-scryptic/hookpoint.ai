import type { SupabaseClient } from "@supabase/supabase-js"

import {
  generatePacingAnalysis,
  type PacingAnalysis,
  type PacingWindow,
} from "@/lib/pacing-analysis"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

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

// A claim older than this is treated as abandoned (the caller was almost
// certainly killed by a function timeout mid-call) and can be reclaimed,
// rather than blocking pacing analysis for this video forever.
const PACING_CLAIM_STALE_MS = 10 * 60 * 1000

// Atomically claims the right to generate a pacing analysis for this video:
// the UPDATE only succeeds when nothing else is already claiming it (no
// status yet, a previous attempt failed, or a stale abandoned claim), so two
// callers racing each other (this can be triggered from /api/analyze, the
// dashboard page's render, or a second tab/refresh) can't both call OpenAI
// for the same video. Returns false when another caller already holds the
// claim — the losing caller should just skip generating.
async function claimPacingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - PACING_CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("analysed_videos")
    .update({
      pacing_analysis_status: "processing",
      pacing_analysis_claimed_at: new Date().toISOString(),
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .or(
      `pacing_analysis_status.is.null,pacing_analysis_status.eq.failed,pacing_analysis_claimed_at.lt.${staleBefore}`,
    )
    .select("id")

  if (error) {
    throw new Error(`Failed to claim pacing analysis: ${error.message}`)
  }

  return (data?.length ?? 0) > 0
}

// Releases a claim taken by claimPacingAnalysis. 'done' clears it entirely —
// pacing_analyses having a row is the source of truth for "already
// generated" from then on. 'failed' leaves a marker so the next attempt is
// allowed to retry immediately rather than waiting out the staleness window.
async function releasePacingAnalysisClaim(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  outcome: "done" | "failed",
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({
      pacing_analysis_status: outcome === "done" ? null : "failed",
      pacing_analysis_claimed_at: null,
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to release pacing analysis claim: ${error.message}`)
  }
}

// Loads a saved pacing analysis if one already exists; otherwise claims the
// right to generate one and does so, saving the result before returning it.
// Returns null (without calling OpenAI) when a transcript isn't available, or
// when another caller is already generating this video's pacing analysis —
// callers should treat null as "nothing to show yet", not as a failure.
export async function getOrGeneratePacingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  transcript: TranscriptCue[],
): Promise<PacingAnalysis | null> {
  const existing = await getPacingAnalysis(supabase, userId, analysedVideoId)
  if (existing) return existing
  if (transcript.length === 0) return null

  const claimed = await claimPacingAnalysis(supabase, userId, analysedVideoId)
  if (!claimed) return null

  try {
    const pacingAnalysis = await generatePacingAnalysis(video, transcript)
    if (pacingAnalysis) {
      await savePacingAnalysis(supabase, userId, analysedVideoId, pacingAnalysis)
    }
    await releasePacingAnalysisClaim(supabase, userId, analysedVideoId, "done")
    return pacingAnalysis
  } catch (error) {
    // Best-effort: if clearing the claim itself fails, the original error is
    // what the caller needs to see, not a masking failure from the release.
    await releasePacingAnalysisClaim(
      supabase,
      userId,
      analysedVideoId,
      "failed",
    ).catch(() => {})
    throw error
  }
}
