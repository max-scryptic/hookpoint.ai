// Read/generate helper for the packaging_alignment JSONB column on
// analysed_videos. Same load-or-claim-then-generate shape as the retention
// attribution helper, using the shared claim columns for its in-flight guard.

import type { SupabaseClient } from "@supabase/supabase-js"

import { claimAnalysis, releaseAnalysisClaim } from "@/lib/analysis-claim"
import {
  generatePackagingAlignment,
  type PackagingAlignment,
} from "@/lib/packaging-alignment"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

const CLAIM_COLUMNS = {
  statusColumn: "packaging_alignment_status",
  claimedAtColumn: "packaging_alignment_claimed_at",
} as const

export async function getPackagingAlignment(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<PackagingAlignment | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("packaging_alignment")
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load packaging alignment: ${error.message}`)
  }

  return (
    (data as { packaging_alignment: PackagingAlignment | null } | null)
      ?.packaging_alignment ?? null
  )
}

async function savePackagingAlignment(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  alignment: PackagingAlignment,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({ packaging_alignment: alignment })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to save packaging alignment: ${error.message}`)
  }
}

// Loads a saved alignment if one exists; otherwise claims and generates one.
// Returns null (without calling OpenAI) when there's no thumbnail to look at,
// or when another caller is already generating it.
export async function getOrGeneratePackagingAlignment(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: Pick<VideoDetails, "title" | "description" | "thumbnailUrl">,
  transcript: TranscriptCue[],
): Promise<PackagingAlignment | null> {
  const existing = await getPackagingAlignment(supabase, userId, analysedVideoId)
  if (existing) return existing
  if (!video.thumbnailUrl) return null

  const claimed = await claimAnalysis(
    supabase,
    userId,
    analysedVideoId,
    CLAIM_COLUMNS,
  )
  if (!claimed) return null

  try {
    const alignment = await generatePackagingAlignment(video, transcript)
    if (alignment) {
      await savePackagingAlignment(supabase, userId, analysedVideoId, alignment)
    }
    await releaseAnalysisClaim(supabase, userId, analysedVideoId, CLAIM_COLUMNS, "done")
    return alignment
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
