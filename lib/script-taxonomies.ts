// Read/generate helper for the script_taxonomy JSONB column on analysed_videos.
// Same load-or-claim-then-generate shape as the packaging alignment and
// retention attribution helpers, using the shared claim columns for its
// in-flight guard.
//
// Unlike packaging (which only needs the thumbnail and the 30s hook), the
// script taxonomy reads the full transcript, so it generates only when a
// timestamped transcript is available. A stored taxonomy whose schemaVersion is
// below the current one is healed with a fresh call the next time its detail
// page loads, the same opportunistic-backfill pattern the other reads use.

import type { SupabaseClient } from "@supabase/supabase-js"

import { claimAnalysis, releaseAnalysisClaim } from "@/lib/analysis-claim"
import {
  generateScriptTaxonomy,
  isCurrentScriptTaxonomy,
  type ScriptTaxonomy,
} from "@/lib/script-taxonomy"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

const CLAIM_COLUMNS = {
  statusColumn: "script_taxonomy_status",
  claimedAtColumn: "script_taxonomy_claimed_at",
} as const

export async function getScriptTaxonomy(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<ScriptTaxonomy | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("script_taxonomy")
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load script taxonomy: ${error.message}`)
  }

  return (
    (data as { script_taxonomy: ScriptTaxonomy | null } | null)
      ?.script_taxonomy ?? null
  )
}

async function saveScriptTaxonomy(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  taxonomy: ScriptTaxonomy,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({ script_taxonomy: taxonomy })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to save script taxonomy: ${error.message}`)
  }
}

// Loads a saved taxonomy if one exists at the current schema version;
// otherwise (missing or stale) claims the right to generate one and does so,
// saving the result before returning it. Returns null (without calling OpenAI)
// when there's no transcript to read, or when another caller is already
// generating it — callers should treat null as "nothing to show yet", not as a
// failure. Any generation failure serves the existing stored taxonomy (which
// may be an out-of-date one) rather than sinking the caller, and the backfill
// is retried on the next visit.
export async function getOrGenerateScriptTaxonomy(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  transcript: TranscriptCue[],
): Promise<ScriptTaxonomy | null> {
  const existing = await getScriptTaxonomy(supabase, userId, analysedVideoId)
  if (existing && isCurrentScriptTaxonomy(existing)) return existing
  if (transcript.length === 0) return existing

  const claimed = await claimAnalysis(
    supabase,
    userId,
    analysedVideoId,
    CLAIM_COLUMNS,
  )
  if (!claimed) return existing

  try {
    const taxonomy = await generateScriptTaxonomy(video, transcript, {
      userId,
      analysedVideoId,
    })
    if (taxonomy) {
      await saveScriptTaxonomy(supabase, userId, analysedVideoId, taxonomy)
    }
    await releaseAnalysisClaim(
      supabase,
      userId,
      analysedVideoId,
      CLAIM_COLUMNS,
      "done",
    )
    return taxonomy ?? existing
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
