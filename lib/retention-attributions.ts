// Read/generate helper for the retention_attribution JSONB column on
// analysed_videos. Follows the same "load-or-claim-then-generate" shape as
// lib/pacing-analyses.ts, but the report is small and single-shot so it lives
// in a column rather than its own normalized table.

import type { SupabaseClient } from "@supabase/supabase-js"

import { claimAnalysis, releaseAnalysisClaim } from "@/lib/analysis-claim"
import {
  generateRetentionAttribution,
  RETENTION_ATTRIBUTION_SCHEMA_VERSION,
  type RetentionAttribution,
} from "@/lib/retention-attribution"
import type { RetentionWindow } from "@/lib/retention-windows"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

const CLAIM_COLUMNS = {
  statusColumn: "retention_attribution_status",
  claimedAtColumn: "retention_attribution_claimed_at",
} as const

export async function getRetentionAttribution(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionAttribution | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("retention_attribution")
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load retention attribution: ${error.message}`)
  }

  return (
    (data as { retention_attribution: RetentionAttribution | null } | null)
      ?.retention_attribution ?? null
  )
}

async function saveRetentionAttribution(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  attribution: RetentionAttribution,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({ retention_attribution: attribution })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to save retention attribution: ${error.message}`)
  }
}

// Loads a saved attribution if one exists; otherwise claims the right to
// generate one and does so. Returns null (without calling OpenAI) when there's
// nothing to attribute, or when another caller is already generating it —
// callers treat null as "nothing to show yet", not a failure.
export async function getOrGenerateRetentionAttribution(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  windows: RetentionWindow[],
  transcript: TranscriptCue[],
): Promise<RetentionAttribution | null> {
  const existing = await getRetentionAttribution(supabase, userId, analysedVideoId)
  if (existing?.schemaVersion === RETENTION_ATTRIBUTION_SCHEMA_VERSION) {
    return existing
  }
  if (transcript.length === 0) return null

  const claimed = await claimAnalysis(
    supabase,
    userId,
    analysedVideoId,
    CLAIM_COLUMNS,
  )
  if (!claimed) return null

  try {
    const attribution = await generateRetentionAttribution(
      video,
      windows,
      transcript,
      { userId, analysedVideoId },
    )
    if (attribution) {
      await saveRetentionAttribution(supabase, userId, analysedVideoId, attribution)
    }
    await releaseAnalysisClaim(supabase, userId, analysedVideoId, CLAIM_COLUMNS, "done")
    return attribution
  } catch (error) {
    await releaseAnalysisClaim(
      supabase,
      userId,
      analysedVideoId,
      CLAIM_COLUMNS,
      "failed",
    ).catch(() => {})
    throw error
  }
}
