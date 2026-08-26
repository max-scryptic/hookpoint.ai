// Generic single-report claim/release used by the surface-level LLM analyses
// that store their result as a JSONB column on analysed_videos (retention
// attribution, packaging alignment). It mirrors the atomic claim pattern
// lib/pacing-analyses.ts introduced: several independent callers (the
// /api/analyze route, the detail page render, a second tab or refresh) can
// legitimately fire close together, so before spending an OpenAI call each
// feature flips its status column pending -> 'processing' with an UPDATE that
// only succeeds for one racing caller. The result column being non-null is the
// source of truth for "already generated"; the status column just guards the
// in-flight window.

import type { SupabaseClient } from "@supabase/supabase-js"

// A claim older than this is treated as abandoned (the caller was almost
// certainly killed by a function timeout mid-call) and can be reclaimed, so a
// stuck claim never blocks a feature for a video forever. Matches the window
// pacing analysis already uses.
const CLAIM_STALE_MS = 10 * 60 * 1000

export interface AnalysisClaimColumns {
  // Column holding 'processing' | 'failed' | null.
  statusColumn: string
  // Column holding the timestamp the current claim was taken.
  claimedAtColumn: string
}

// Atomically claims the right to generate this analysis for `analysedVideoId`.
// The UPDATE only lands when nothing else is already claiming it (no status
// yet, a previous attempt failed, or a stale abandoned claim). Returns false
// when another caller already holds the claim - the loser should skip
// generating and let the winner's result surface on the next read.
export async function claimAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  { statusColumn, claimedAtColumn }: AnalysisClaimColumns,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("analysed_videos")
    .update({
      [statusColumn]: "processing",
      [claimedAtColumn]: new Date().toISOString(),
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .or(
      `${statusColumn}.is.null,${statusColumn}.eq.failed,${claimedAtColumn}.lt.${staleBefore}`,
    )
    .select("id")

  if (error) {
    throw new Error(`Failed to claim analysis (${statusColumn}): ${error.message}`)
  }

  return (data?.length ?? 0) > 0
}

// Releases a claim taken by claimAnalysis. 'done' clears it entirely - the
// result column being non-null is the source of truth for "already generated"
// from then on. 'failed' leaves a marker so the next attempt can retry
// immediately rather than waiting out the staleness window.
export async function releaseAnalysisClaim(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  { statusColumn, claimedAtColumn }: AnalysisClaimColumns,
  outcome: "done" | "failed",
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({
      [statusColumn]: outcome === "done" ? null : "failed",
      [claimedAtColumn]: null,
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to release analysis claim (${statusColumn}): ${error.message}`,
    )
  }
}
