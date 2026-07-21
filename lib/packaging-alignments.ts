// Read/generate helper for the packaging_alignment JSONB column on
// analysed_videos. Same load-or-claim-then-generate shape as the retention
// attribution helper, using the shared claim columns for its in-flight guard.
//
// The column holds two generated reads of the same packaging: the prose
// alignment (lib/packaging-alignment.ts) and the categorical taxonomy
// (lib/packaging-taxonomy.ts). New videos get both in one visit; videos whose
// alignment predates the taxonomy are healed here with a taxonomy-only call
// the next time their detail page loads — same opportunistic-backfill pattern
// as the analytics summary.

import type { SupabaseClient } from "@supabase/supabase-js"

import { claimAnalysis, releaseAnalysisClaim } from "@/lib/analysis-claim"
import {
  generatePackagingAlignment,
  type PackagingAlignment,
} from "@/lib/packaging-alignment"
import {
  generatePackagingTaxonomy,
  isCurrentTaxonomy,
} from "@/lib/packaging-taxonomy"
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

// Loads a saved alignment if one exists (healing in a missing or out-of-date
// taxonomy for rows that predate the current schema); otherwise claims and
// generates the alignment and taxonomy together. Returns null (without calling
// OpenAI) when there's no thumbnail to look at, or when another caller is
// already generating it.
export async function getOrGeneratePackagingAlignment(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: Pick<VideoDetails, "title" | "description" | "thumbnailUrl">,
  transcript: TranscriptCue[],
): Promise<PackagingAlignment | null> {
  const existing = await getPackagingAlignment(supabase, userId, analysedVideoId)
  if (existing?.taxonomy && isCurrentTaxonomy(existing.taxonomy)) return existing
  if (!video.thumbnailUrl) return existing
  if (existing) {
    // Present but missing or below the current schema version: regenerate the
    // taxonomy so older rows pick up the enriched detail on this visit.
    return backfillPackagingTaxonomy(
      supabase,
      userId,
      analysedVideoId,
      existing,
      video,
      transcript,
    )
  }

  const claimed = await claimAnalysis(
    supabase,
    userId,
    analysedVideoId,
    CLAIM_COLUMNS,
  )
  if (!claimed) return null

  try {
    // Two independent reads of the same inputs; a taxonomy failure never
    // costs the user the prose alignment.
    const [alignment, taxonomy] = await Promise.all([
      generatePackagingAlignment(video, transcript, { userId, analysedVideoId }),
      generatePackagingTaxonomy(video, transcript, {
        userId,
        analysedVideoId,
      }).catch((error) => {
        console.error("Failed to generate packaging taxonomy", error)
        return null
      }),
    ])
    const combined =
      alignment && taxonomy ? { ...alignment, taxonomy } : alignment
    if (combined) {
      await savePackagingAlignment(supabase, userId, analysedVideoId, combined)
    }
    await releaseAnalysisClaim(supabase, userId, analysedVideoId, CLAIM_COLUMNS, "done")
    return combined
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

// Adds (or refreshes) the taxonomy on an alignment whose taxonomy is missing
// or predates the current schema version. Best-effort:
// any failure (including losing the claim to a concurrent visit) serves the
// stored prose alignment unchanged, and the backfill is retried on the next
// visit.
async function backfillPackagingTaxonomy(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  existing: PackagingAlignment,
  video: Pick<VideoDetails, "title" | "thumbnailUrl">,
  transcript: TranscriptCue[],
): Promise<PackagingAlignment> {
  try {
    const claimed = await claimAnalysis(
      supabase,
      userId,
      analysedVideoId,
      CLAIM_COLUMNS,
    )
    if (!claimed) return existing

    try {
      const taxonomy = await generatePackagingTaxonomy(video, transcript, {
        userId,
        analysedVideoId,
      })
      const healed = taxonomy ? { ...existing, taxonomy } : existing
      if (taxonomy) {
        await savePackagingAlignment(supabase, userId, analysedVideoId, healed)
      }
      await releaseAnalysisClaim(
        supabase,
        userId,
        analysedVideoId,
        CLAIM_COLUMNS,
        "done",
      )
      return healed
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
  } catch (error) {
    console.error("Failed to backfill packaging taxonomy", error)
    return existing
  }
}
