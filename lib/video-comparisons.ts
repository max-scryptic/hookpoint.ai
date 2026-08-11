// Persistence for saved Video Comparator head-to-heads. Generating a comparison
// costs deep-dive credits, so each generated pair is stored (see the
// video_comparisons migration): it powers the "previous comparisons" list and
// lets an already-paid-for pair be re-opened for free.
//
// The three written head-to-heads (retention, script and packaging) are each one
// model call, so they are generated once, when the creator presses the button,
// and stored on the row here. The report page only ever reads them back: it
// never generates, so opening or re-opening a report costs nothing and shows no
// loading state. The retention and packaging diffs below the written reports are
// pure arithmetic over each video's stored analysis and are still derived on load
// (see lib/retention-comparison.ts), so a re-open reflects the freshest
// analysis without any model call.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
import type { RetentionComparisonReport } from "@/lib/retention-comparison-report"
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
  // The most recent moment any of the three head-to-heads on this pair was
  // written, as an ISO timestamp. Normalised (createdAt comes back in Postgres's
  // own format, a stored generatedAt in ISO) so the two are safe to sort
  // against each other. Falls back to createdAt, so every pair has one whether
  // or not a report ever landed on it.
  lastWrittenAt: string
  // True when a report on this pair was written long enough after the pair
  // itself that only a later press of the button can have done it. The history
  // says so, because otherwise finishing a stale pair changes nothing the
  // creator can see: the row keeps its original date and its original place in
  // the list, which reads as the work having gone nowhere.
  rewritten: boolean
  // True when all three written head-to-heads are stored at the current shape, so
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
  retention_ready: string | null
  script_written: string | null
  packaging_written: string | null
  retention_written: string | null
}

// Whether a stored report is present and current, without dragging the whole
// JSON blob back for every row. Every report always carries a schemaVersion (see
// each report module's normalizer), so that one key answers both questions.
const REPORT_READY_PROBE =
  "script_ready:script_report->>schemaVersion, packaging_ready:packaging_report->>schemaVersion, retention_ready:retention_report->>schemaVersion"

// When each stored report was written, probed the same way and for the same
// reason: it is one key out of each blob, not the blob. Every report carries a
// generatedAt (see each report module's normalizer), which is what lets the
// history show a pair that was rewritten after the fact.
const REPORT_WRITTEN_PROBE =
  "script_written:script_report->>generatedAt, packaging_written:packaging_report->>generatedAt, retention_written:retention_report->>generatedAt"

// Everything the history and the generate endpoint need about a saved pair,
// without reading a single report body back.
const COMPARISON_COLUMNS = `id, video_a_id, video_b_id, created_at, ${REPORT_READY_PROBE}, ${REPORT_WRITTEN_PROBE}`

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
    ) &&
    reportIsCurrent(
      row.retention_ready,
      RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
    )
  )
}

// When this pair last had a report written onto it, and whether that was a
// later press of the button rather than the run that created it.
//
// The run that creates a pair writes all three head-to-heads within its own
// lifetime, and that lifetime is capped (see maxDuration on the generate
// route), so a report stamped well beyond the pair's own creation cannot have
// come from it. ABANDONED_COMPARISON_GRACE_MS is already the window past which
// no run can still be alive, so it is the same line drawn here: past it, the
// only thing that can have written a report is somebody pressing the button
// again on a pair that was already in their history.
//
// Exported for its own test, and because the shape of this rule is the whole
// reason a rewritten pair is visible in the history at all.
export function comparisonWriteState(row: {
  created_at: string
  script_written: string | null
  packaging_written: string | null
  retention_written: string | null
}): { lastWrittenAt: string; rewritten: boolean } {
  const createdAt = new Date(row.created_at).getTime()
  const written = [row.script_written, row.packaging_written, row.retention_written]
    .map((value) => (value == null ? Number.NaN : new Date(value).getTime()))
    .filter((value) => Number.isFinite(value))

  const latest = written.length > 0 ? Math.max(...written) : Number.NaN
  if (!Number.isFinite(createdAt)) {
    // Nothing to measure against, so report the row as it stands rather than
    // guessing. A pair whose timestamp we cannot read is not a rewritten one.
    return { lastWrittenAt: row.created_at, rewritten: false }
  }
  if (!Number.isFinite(latest) || latest <= createdAt) {
    return { lastWrittenAt: new Date(createdAt).toISOString(), rewritten: false }
  }

  return {
    lastWrittenAt: new Date(latest).toISOString(),
    rewritten: latest - createdAt > ABANDONED_COMPARISON_GRACE_MS,
  }
}

// The same test against a report already read back in full, for the generate
// endpoint deciding which of the three it has to write on this press.
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

export function isRetentionReportCurrent(
  report: RetentionComparisonReport | null,
): boolean {
  return (
    report != null &&
    reportIsCurrent(
      String(report.schemaVersion),
      RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
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
    .select(COMPARISON_COLUMNS)
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
    ...comparisonWriteState(row),
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
    .select(COMPARISON_COLUMNS)
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
    ...comparisonWriteState(row),
    reportsReady: reportsReady(row),
  }
}

// All three stored, model-authored head-to-heads for a saved comparison, read in
// a single query. A null side means that report has not been generated yet: the
// report page renders without it rather than writing one on the fly, and
// re-opening the pair from the Video Comparator fills it in for free. A report
// stored against an older shape comes back as it was stored, so the page can
// render what it has; isScriptReportCurrent, isPackagingReportCurrent and
// isRetentionReportCurrent are what the generate endpoint uses to decide it is
// worth rewriting. Scoped to the owning user via RLS.
export interface StoredComparisonReports {
  script: ScriptComparisonReport | null
  packaging: PackagingComparisonReport | null
  retention: RetentionComparisonReport | null
}

export async function getComparisonReports(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
): Promise<StoredComparisonReports> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .select("script_report, packaging_report, retention_report")
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load comparison reports: ${error.message}`)
  }

  const row = data as {
    script_report: ScriptComparisonReport | null
    packaging_report: PackagingComparisonReport | null
    retention_report: RetentionComparisonReport | null
  } | null

  return {
    script: row?.script_report ?? null,
    packaging: row?.packaging_report ?? null,
    retention: row?.retention_report ?? null,
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

// Stores the generated retention head-to-head on the comparison row. Scoped to
// the owning user via RLS so a comparison can only be written by its creator.
export async function saveRetentionComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  report: RetentionComparisonReport,
): Promise<void> {
  const { error } = await supabase
    .from("video_comparisons")
    .update({ retention_report: report })
    .eq("id", comparisonId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to save retention comparison report: ${error.message}`,
    )
  }
}

// How long after it was created a comparison carrying no written report at all
// is treated as abandoned rather than as one still being written. The generate
// endpoint is capped at 300 seconds (see its maxDuration), so anything older
// than this cannot still be in flight, whichever tab or device started it.
export const ABANDONED_COMPARISON_GRACE_MS = 15 * 60 * 1000

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

  const row = data as { id: string; video_a_id: string; video_b_id: string; created_at: string }
  return {
    id: row.id,
    videoAId: row.video_a_id,
    videoBId: row.video_b_id,
    videoATitle: null,
    videoBTitle: null,
    videoAThumbnailUrl: null,
    videoBThumbnailUrl: null,
    createdAt: row.created_at,
    // The row is one insert old, so no head-to-head can be on it yet: nothing
    // has been written, and nothing can have been rewritten. The caller writes
    // all three before it responds.
    lastWrittenAt: row.created_at,
    rewritten: false,
    reportsReady: false,
  }
}

// The outcome of trying to take a row for the run that is about to write onto
// it. Granted means go ahead; claimedAt is the stamp to release it with, or null
// when the claim could not be taken at all and the run proceeds unguarded.
export type ComparisonRunClaim =
  | { granted: true; claimedAt: string | null }
  | { granted: false }

// Takes this row for the run that is about to write onto it.
//
// Writing a head-to-head is three model calls, and the generate endpoint is
// reachable more than once for the same pair: a second tab, a reload landing on
// a picker whose button still says "Finish report", two presses either side of a
// navigation. Without this, each of those ran the full generation against the
// same row and the last to finish overwrote the others, so the creator saw one
// report and we paid for several.
//
// The claim is one conditional update, which is what makes it safe: Postgres
// re-checks the predicate after a competing update commits, so of two runs
// racing for the same row exactly one comes back with a stamp. A run that dies
// without releasing its claim only holds the row until the grace window passes,
// so a pair can never be left permanently unfinishable.
//
// A claim that cannot be taken at all grants the run anyway. Migrations here are
// applied out of band from deploys, so this code can be live for a window before
// the column it writes to exists, and the two failures are not comparable: an
// unguarded run risks paying for a report twice, while a refused one is a
// creator who cannot generate a comparison at all.
export async function claimComparisonRun(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  now: Date = new Date(),
): Promise<ComparisonRunClaim> {
  const claimedAt = now.toISOString()
  const staleBefore = new Date(
    now.getTime() - ABANDONED_COMPARISON_GRACE_MS,
  ).toISOString()

  const { data, error } = await supabase
    .from("video_comparisons")
    .update({ report_run_started_at: claimedAt })
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .or(
      `report_run_started_at.is.null,report_run_started_at.lt.${staleBefore}`,
    )
    .select("id")

  if (error) {
    console.error("Failed to claim comparison run", error.message)
    return { granted: true, claimedAt: null }
  }

  return ((data ?? []) as Array<{ id: string }>).length > 0
    ? { granted: true, claimedAt }
    : { granted: false }
}

// Gives the row back once the run has finished with it. Only ever releases this
// run's own claim: a run that overran the grace window has already had the row
// taken off it, and must not clear the stamp of whoever has it now. Best-effort,
// since this runs on the way out of a request whose real work is already done
// (and whose row may have been rolled back out from under it).
export async function releaseComparisonRun(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  claimedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("video_comparisons")
    .update({ report_run_started_at: null })
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .eq("report_run_started_at", claimedAt)

  if (error) {
    console.error("Failed to release comparison run", error.message)
  }
}

// Removes a saved comparison, and reports whether it removed anything. Every
// caller is undoing an abandoned run, and the credits only go back when a row
// actually went away, so the answer matters: the same abandonment can be
// reported more than once (the creator's browser says so on its way out, and
// the server notices the dropped connection independently), and only the first
// report finds a row to delete. Scoped to the owning creator via RLS.
export async function deleteComparison(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .delete()
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .select("id")

  if (error) {
    throw new Error(`Failed to delete comparison: ${error.message}`)
  }

  return ((data ?? []) as Array<{ id: string }>).length > 0
}

// Removes the pair's comparison, but only when this run is the run that created
// it. The creator's browser reports an abandonment by pair (it never learns the
// row's id, since it left before the response), and pressing the button on a
// pair that already existed writes a missing section onto a row that was paid
// for long ago: leaving that behind is the whole point, because it is what the
// creator had before they pressed.
//
// Two things keep this to the abandoned run's own row. Only a row created at or
// after the moment the run started can be this run's, and only a row carrying
// none of the three written head-to-heads can be one nothing was ever written
// onto. The second is what carries the weight when the first cannot be trusted
// to the millisecond: startedAt is read off the creator's clock, which is not
// the clock created_at was stamped by.
export async function deleteComparisonCreatedSince(
  supabase: SupabaseClient,
  userId: string,
  videoAId: string,
  videoBId: string,
  startedAt: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("video_comparisons")
    .delete()
    .eq("user_id", userId)
    .gte("created_at", startedAt.toISOString())
    .is("script_report", null)
    .is("packaging_report", null)
    .is("retention_report", null)
    .or(
      `and(video_a_id.eq.${videoAId},video_b_id.eq.${videoBId}),and(video_a_id.eq.${videoBId},video_b_id.eq.${videoAId})`,
    )
    .select("id")

  if (error) {
    throw new Error(`Failed to delete abandoned comparison: ${error.message}`)
  }

  return ((data ?? []) as Array<{ id: string }>).length > 0
}

// A comparison left behind by a run nobody ever reported the end of: the tab was
// closed without the browser getting its message out, the laptop went to sleep,
// the deploy that was writing the report went away. Such a row carries no
// written head-to-head at all and cannot still be being written (see
// ABANDONED_COMPARISON_GRACE_MS), so it is exactly the state the creator was
// charged for and never received.
export interface AbandonedComparison {
  id: string
  createdAt: string
}

// Deletes those rows for one creator and says which ones went, so the caller can
// hand back the credits each of them was charged. Every row this returns was
// deleted by this call, so a refund can follow one for one even if two page
// loads race.
export async function deleteAbandonedComparisons(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AbandonedComparison[]> {
  const cutoff = new Date(now.getTime() - ABANDONED_COMPARISON_GRACE_MS)
  const { data, error } = await supabase
    .from("video_comparisons")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff.toISOString())
    .is("script_report", null)
    .is("packaging_report", null)
    .is("retention_report", null)
    .select("id, created_at")

  if (error) {
    throw new Error(`Failed to clear abandoned comparisons: ${error.message}`)
  }

  return ((data ?? []) as Array<{ id: string; created_at: string }>).map(
    (row) => ({ id: row.id, createdAt: row.created_at }),
  )
}
