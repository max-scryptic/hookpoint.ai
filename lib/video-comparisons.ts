// Persistence for saved Video Comparator head-to-heads. Generating a comparison
// costs deep-dive credits, so each generated pair is stored (see the
// video_comparisons migration): it powers the "previous comparisons" list and
// lets an already-paid-for pair be re-opened for free. The comparison report
// itself is never stored here; it is recomputed from each video's stored deep
// analysis on load (see lib/retention-comparison.ts), so a re-open always
// reflects the freshest analysis.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ScriptComparisonReport } from "@/lib/script-comparison-report"

// A row of the compare page's "previous comparisons" list: the saved pair plus
// the two titles and thumbnails, resolved for display.
export interface SavedComparison {
  id: string
  videoAId: string
  videoBId: string
  videoATitle: string | null
  videoBTitle: string | null
  videoAThumbnailUrl: string | null
  videoBThumbnailUrl: string | null
  createdAt: string
}

interface ComparisonRow {
  id: string
  video_a_id: string
  video_b_id: string
  created_at: string
}

// True when two saved pairs are the same head-to-head, regardless of the order
// the two videos were picked in. (A, B) and (B, A) are one comparison.
export function isSamePair(
  first: { a: string; b: string },
  second: { a: string; b: string },
): boolean {
  return (
    (first.a === second.a && first.b === second.b) ||
    (first.a === second.b && first.b === second.a)
  )
}

// The creator's saved comparisons, newest first, with each side's title joined
// in for the list. Titles are looked up in a single follow-up query so a
// missing analysed_videos row (deleted video) simply yields a null title rather
// than dropping the comparison.
export async function listSavedComparisons(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<SavedComparison[]> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .select("id, video_a_id, video_b_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load saved comparisons: ${error.message}`)
  }

  const rows = (data ?? []) as ComparisonRow[]
  if (rows.length === 0) return []

  const videoIds = [
    ...new Set(rows.flatMap((row) => [row.video_a_id, row.video_b_id])),
  ]
  const { data: titleData, error: titleError } = await supabase
    .from("analysed_videos")
    .select("id, video_title, thumbnail_url:video_details->>thumbnailUrl")
    .eq("user_id", userId)
    .in("id", videoIds)

  if (titleError) {
    throw new Error(
      `Failed to load comparison titles: ${titleError.message}`,
    )
  }

  const videoById = new Map(
    (
      (titleData ?? []) as Array<{
        id: string
        video_title: string | null
        thumbnail_url: string | null
      }>
    ).map((row) => [
      row.id,
      { title: row.video_title, thumbnailUrl: row.thumbnail_url },
    ]),
  )

  return rows.map((row) => ({
    id: row.id,
    videoAId: row.video_a_id,
    videoBId: row.video_b_id,
    videoATitle: videoById.get(row.video_a_id)?.title ?? null,
    videoBTitle: videoById.get(row.video_b_id)?.title ?? null,
    videoAThumbnailUrl: videoById.get(row.video_a_id)?.thumbnailUrl ?? null,
    videoBThumbnailUrl: videoById.get(row.video_b_id)?.thumbnailUrl ?? null,
    createdAt: row.created_at,
  }))
}

// The saved comparison for an unordered pair, or null when it has not been
// generated yet. Used both to gate the report on the page (only paid-for pairs
// render) and to keep the generate endpoint idempotent (a swapped re-generate
// re-opens the existing row instead of charging again).
export async function findSavedComparison(
  supabase: SupabaseClient,
  userId: string,
  videoAId: string,
  videoBId: string,
): Promise<SavedComparison | null> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .select("id, video_a_id, video_b_id, created_at")
    .eq("user_id", userId)
    .or(
      `and(video_a_id.eq.${videoAId},video_b_id.eq.${videoBId}),and(video_a_id.eq.${videoBId},video_b_id.eq.${videoAId})`,
    )
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to look up saved comparison: ${error.message}`)
  }
  if (data == null) return null

  const row = data as ComparisonRow
  return {
    id: row.id,
    videoAId: row.video_a_id,
    videoBId: row.video_b_id,
    videoATitle: null,
    videoBTitle: null,
    videoAThumbnailUrl: null,
    videoBThumbnailUrl: null,
    createdAt: row.created_at,
  }
}

// Loads the stored, model-authored script head-to-head for a saved comparison,
// or null when it has not been generated yet (in which case the report page
// regenerates it lazily). Scoped to the owning user via RLS.
export async function getScriptComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
): Promise<ScriptComparisonReport | null> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .select("script_report")
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load script comparison report: ${error.message}`)
  }

  return (
    (data as { script_report: ScriptComparisonReport | null } | null)
      ?.script_report ?? null
  )
}

// Stores the generated script head-to-head on the comparison row. Scoped to the
// owning user via RLS so a comparison can only be written by its creator.
export async function saveScriptComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  report: ScriptComparisonReport,
): Promise<void> {
  const { error } = await supabase
    .from("video_comparisons")
    .update({ script_report: report })
    .eq("id", comparisonId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to save script comparison report: ${error.message}`)
  }
}

// Records a newly generated comparison for the pair, in the order the creator
// picked them. The caller charges credits before inserting; the unique index on
// the unordered pair is the backstop against a duplicate slipping through a
// race.
export async function createSavedComparison(
  supabase: SupabaseClient,
  userId: string,
  videoAId: string,
  videoBId: string,
): Promise<SavedComparison> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .insert({
      user_id: userId,
      video_a_id: videoAId,
      video_b_id: videoBId,
    })
    .select("id, video_a_id, video_b_id, created_at")
    .single()

  if (error) {
    throw new Error(`Failed to save comparison: ${error.message}`)
  }

  const row = data as ComparisonRow
  return {
    id: row.id,
    videoAId: row.video_a_id,
    videoBId: row.video_b_id,
    videoATitle: null,
    videoBTitle: null,
    videoAThumbnailUrl: null,
    videoBThumbnailUrl: null,
    createdAt: row.created_at,
  }
}
