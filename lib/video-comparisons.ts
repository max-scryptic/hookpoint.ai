// Persistence for saved Video Comparator head-to-heads. Generating a comparison
// costs deep-dive credits, so each generated pair is stored (see the
// video_comparisons migration): it powers the "previous comparisons" list and
// lets an already-paid-for pair be re-opened for free.
//
// The two written head-to-heads (script and packaging) are each one model call,
// so they are generated once, when the creator presses the button, and stored on
// the row here. The report page only ever reads them back: it never generates,
// so opening or re-opening a report costs nothing and shows no loading state.
// The retention and packaging diffs below the written reports are pure
// arithmetic over each video's stored analysis and are still derived on load
// (see lib/retention-comparison.ts), so a re-open reflects the freshest
// analysis without any model call.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
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
  // True when both written head-to-heads are stored at the current shape, so
  // this pair opens into a complete report with nothing left to write. False for
  // a pair created before one of those reports existed, one whose generation
  // failed, or one whose report was written against an older shape: pressing the
  // button on it again writes the missing or outdated part, for free.
  reportsReady: boolean
}

interface ComparisonRow {
  id: string
  video_a_id: string
  video_b_id: string
  created_at: string
  script_ready: string | null
  packaging_ready: string | null
}

// Whether a stored report is present and current, without dragging the whole
// JSON blob back for every row. Both reports always carry a schemaVersion (see
// each report module's normalizer), so that one key answers both questions.
const REPORT_READY_PROBE =
  "script_ready:script_report->>schemaVersion, packaging_ready:packaging_report->>schemaVersion"

// A report only counts as ready at the current shape version: an older one is
// missing whatever the bump added (version 5 of the packaging report, for
// example, is what guarantees every surface a "Try:" line), and the creator has
// no way to ask for the newer shape other than the generate button, which
// rewrites it for free. A version we do not recognise (a row written by a newer
// deploy, or a non-numeric value) reads as ready rather than sending it round
// the generator again. Exported so the admin read layer can report the same
// readiness per report (see lib/admin/video-comparisons.ts) instead of
// re-deriving the rule beside it.
export function reportIsCurrent(
  storedVersion: string | null,
  currentVersion: number,
): boolean {
  if (storedVersion == null) return false
  const version = Number(storedVersion)
  return Number.isFinite(version) ? version >= currentVersion : true
}

function reportsReady(row: ComparisonRow): boolean {
  return (
    reportIsCurrent(row.script_ready, SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION) &&
    reportIsCurrent(
      row.packaging_ready,
      PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    )
  )
}

// The same test against a report already read back in full, for the generate
// endpoint deciding which of the two it has to write on this press.
export function isScriptReportCurrent(
  report: ScriptComparisonReport | null,
): boolean {
  return (
    report != null &&
    reportIsCurrent(
      String(report.schemaVersion),
      SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
    )
  )
}

export function isPackagingReportCurrent(
  report: PackagingComparisonReport | null,
): boolean {
  return (
    report != null &&
    reportIsCurrent(
      String(report.schemaVersion),
      PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    )
  )
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
    .select(`id, video_a_id, video_b_id, created_at, ${REPORT_READY_PROBE}`)
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
    reportsReady: reportsReady(row),
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
    .select(`id, video_a_id, video_b_id, created_at, ${REPORT_READY_PROBE}`)
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
    reportsReady: reportsReady(row),
  }
}

// Both stored, model-authored head-to-heads for a saved comparison, read in a
// single query. A null side means that report has not been generated yet: the
// report page renders without it rather than writing one on the fly, and
// re-opening the pair from the Video Comparator fills it in for free. A report
// stored against an older shape comes back as it was stored, so the page can
// render what it has; isScriptReportCurrent and isPackagingReportCurrent are
// what the generate endpoint uses to decide it is worth rewriting. Scoped to
// the owning user via RLS.
export interface StoredComparisonReports {
  script: ScriptComparisonReport | null
  packaging: PackagingComparisonReport | null
}

export async function getComparisonReports(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
): Promise<StoredComparisonReports> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .select("script_report, packaging_report")
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load comparison reports: ${error.message}`)
  }

  const row = data as {
    script_report: ScriptComparisonReport | null
    packaging_report: PackagingComparisonReport | null
  } | null

  return {
    script: row?.script_report ?? null,
    packaging: row?.packaging_report ?? null,
  }
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

// Stores the generated packaging head-to-head on the comparison row. Scoped to
// the owning user via RLS so a comparison can only be written by its creator.
export async function savePackagingComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  report: PackagingComparisonReport,
): Promise<void> {
  const { error } = await supabase
    .from("video_comparisons")
    .update({ packaging_report: report })
    .eq("id", comparisonId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to save packaging comparison report: ${error.message}`,
    )
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

  const row = data as Omit<ComparisonRow, "script_ready" | "packaging_ready">
  return {
    id: row.id,
    videoAId: row.video_a_id,
    videoBId: row.video_b_id,
    videoATitle: null,
    videoBTitle: null,
    videoAThumbnailUrl: null,
    videoBThumbnailUrl: null,
    createdAt: row.created_at,
    // The row is one insert old, so neither head-to-head can be on it yet. The
    // caller writes both before it responds.
    reportsReady: false,
  }
}
