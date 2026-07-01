// Read/write helpers for the `retention_windows` table, plus the builder that
// turns a raw retention curve into the discrete windows we persist. A video's
// hook windows, significant drop-offs and retention gains are all derived from
// the same curve, so we compute them once at analyse time and store them as
// rows — mirroring how pacing windows are normalised — instead of re-deriving
// them on every read. All calls go through a user-scoped Supabase client, so
// Row Level Security guarantees a user only ever touches their own rows.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  computeRetentionWindows,
  detectRetentionGains,
  detectSignificantDropOffs,
  HOOK_COVERAGE_END_SECONDS,
  type RetentionPoint,
} from "@/lib/youtube/youtube"

export type RetentionWindowKind = "hook" | "drop_off" | "gain"

// A single persisted retention window. The shape is a superset across the three
// kinds; fields that don't apply to a kind are null (see column comments in the
// migration).
export interface RetentionWindow {
  kind: RetentionWindowKind
  windowIndex: number
  windowKey: string | null
  label: string | null
  fromSeconds: number
  toSeconds: number
  startWatchRatio: number | null
  endWatchRatio: number | null
  // Signed change in watch ratio: negative for losses, positive for gains.
  delta: number
  relativePerformance: number | null
  steepness: number | null
  isAbnormallySteep: boolean | null
  outOfRange: boolean
  // The padded window this retention window should be harvested for
  // thumbnails/audio over — wider than [fromSeconds, toSeconds], which records
  // only the detected hook/drop/gain itself. Null when this row has no
  // analysis window of its own (see computeAnalysisWindow).
  analysisFromSeconds: number | null
  analysisToSeconds: number | null
}

// A retention window as read back from the database, carrying its row id so
// callers can attach child rows (retention_window_snapshots/audio) to it.
export interface PersistedRetentionWindow extends RetentionWindow {
  id: string
}

interface RetentionWindowRow {
  id: string
  kind: RetentionWindowKind
  window_index: number
  window_key: string | null
  label: string | null
  from_seconds: number
  to_seconds: number
  start_watch_ratio: number | null
  end_watch_ratio: number | null
  delta: number
  relative_performance: number | null
  steepness: number | null
  is_abnormally_steep: boolean | null
  out_of_range: boolean
  analysis_from_seconds: number | null
  analysis_to_seconds: number | null
}

const COLUMNS =
  "id, kind, window_index, window_key, label, from_seconds, to_seconds, start_watch_ratio, end_watch_ratio, delta, relative_performance, steepness, is_abnormally_steep, out_of_range, analysis_from_seconds, analysis_to_seconds"

const KINDS: RetentionWindowKind[] = ["hook", "drop_off", "gain"]

// How many significant mid-video drop-offs we surface and store. Matches the
// number the detail view lists under "Biggest drop-offs".
const SIGNIFICANT_DROP_OFF_LIMIT = 4

// Padding (seconds) applied around a drop-off/gain's anchor timestamp — the
// midpoint of its detected [fromSeconds, toSeconds] step — to get the window
// that's actually harvested for thumbnails/audio. Chosen so the harvested
// clip shows what led into the moment and what followed it.
const DROP_OFF_PADDING_BEFORE_SECONDS = 30
const DROP_OFF_PADDING_AFTER_SECONDS = 10
const GAIN_PADDING_BEFORE_SECONDS = 10
const GAIN_PADDING_AFTER_SECONDS = 20

// Derives the padded analysis window for a single retention window row, or
// null when this row has no analysis window of its own:
//   • hook     – one combined 0s..min(30s, duration) window, carried only on
//                window_index 0. hook-delivery (index 1) is already covered by
//                it, so harvesting it again would just duplicate the chunks.
//   • drop_off – 30s before to 10s after the anchor (the midpoint of the
//                detected step, since that step can itself span several
//                seconds on longer videos).
//   • gain     – 10s before to 20s after the anchor. Unlike drop-offs, gains
//                aren't gated to start after the hook, so the lower bound can
//                clamp to 0 for an early gain.
// Both non-hook cases clamp to [0, durationSeconds].
export function computeAnalysisWindow(
  kind: RetentionWindowKind,
  windowIndex: number,
  fromSeconds: number,
  toSeconds: number,
  durationSeconds: number,
): { fromSeconds: number; toSeconds: number } | null {
  if (kind === "hook") {
    if (windowIndex !== 0) return null
    const end =
      durationSeconds > 0
        ? Math.min(HOOK_COVERAGE_END_SECONDS, durationSeconds)
        : HOOK_COVERAGE_END_SECONDS
    return end > 0 ? { fromSeconds: 0, toSeconds: end } : null
  }

  const anchor = (fromSeconds + toSeconds) / 2
  const [before, after] =
    kind === "drop_off"
      ? [DROP_OFF_PADDING_BEFORE_SECONDS, DROP_OFF_PADDING_AFTER_SECONDS]
      : [GAIN_PADDING_BEFORE_SECONDS, GAIN_PADDING_AFTER_SECONDS]

  const from = Math.max(0, anchor - before)
  const to =
    durationSeconds > 0
      ? Math.min(durationSeconds, anchor + after)
      : anchor + after
  return to > from ? { fromSeconds: from, toSeconds: to } : null
}

function mapRow(row: RetentionWindowRow): PersistedRetentionWindow {
  return {
    id: row.id,
    kind: row.kind,
    windowIndex: row.window_index,
    windowKey: row.window_key,
    label: row.label,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    startWatchRatio: row.start_watch_ratio,
    endWatchRatio: row.end_watch_ratio,
    delta: row.delta,
    relativePerformance: row.relative_performance,
    steepness: row.steepness,
    isAbnormallySteep: row.is_abnormally_steep,
    outOfRange: row.out_of_range,
    analysisFromSeconds: row.analysis_from_seconds,
    analysisToSeconds: row.analysis_to_seconds,
  }
}

// Derives the full set of retention windows for a video from its curve: the two
// fixed hook windows, the significant mid-video drop-offs, and the retention
// gains — in that order, each indexed from zero within its kind.
export function buildRetentionWindows(
  retention: RetentionPoint[],
  durationSeconds: number,
): RetentionWindow[] {
  const windows: RetentionWindow[] = []

  computeRetentionWindows(retention, durationSeconds).forEach(
    (hook, windowIndex) => {
      const drop = Math.max(0, hook.startWatchRatio - hook.endWatchRatio)
      const analysisWindow = computeAnalysisWindow(
        "hook",
        windowIndex,
        hook.fromSeconds,
        hook.toSeconds,
        durationSeconds,
      )
      windows.push({
        kind: "hook",
        windowIndex,
        windowKey: hook.id,
        label: hook.label,
        fromSeconds: hook.fromSeconds,
        toSeconds: hook.toSeconds,
        startWatchRatio: hook.startWatchRatio,
        endWatchRatio: hook.endWatchRatio,
        delta: -drop,
        relativePerformance: hook.relativePerformance,
        steepness: null,
        isAbnormallySteep: null,
        outOfRange: hook.outOfRange,
        analysisFromSeconds: analysisWindow?.fromSeconds ?? null,
        analysisToSeconds: analysisWindow?.toSeconds ?? null,
      })
    },
  )

  detectSignificantDropOffs(retention, {
    limit: SIGNIFICANT_DROP_OFF_LIMIT,
  }).forEach((drop, windowIndex) => {
    const analysisWindow = computeAnalysisWindow(
      "drop_off",
      windowIndex,
      drop.fromTimestampSeconds,
      drop.toTimestampSeconds,
      durationSeconds,
    )
    windows.push({
      kind: "drop_off",
      windowIndex,
      windowKey: null,
      label: null,
      fromSeconds: drop.fromTimestampSeconds,
      toSeconds: drop.toTimestampSeconds,
      startWatchRatio: null,
      endWatchRatio: null,
      delta: -drop.watchRatioDrop,
      relativePerformance: drop.relativePerformance,
      steepness: drop.steepness,
      isAbnormallySteep: drop.isAbnormallySteep,
      outOfRange: false,
      analysisFromSeconds: analysisWindow?.fromSeconds ?? null,
      analysisToSeconds: analysisWindow?.toSeconds ?? null,
    })
  })

  detectRetentionGains(retention).forEach((gain, windowIndex) => {
    const analysisWindow = computeAnalysisWindow(
      "gain",
      windowIndex,
      gain.fromTimestampSeconds,
      gain.toTimestampSeconds,
      durationSeconds,
    )
    windows.push({
      kind: "gain",
      windowIndex,
      windowKey: null,
      label: null,
      fromSeconds: gain.fromTimestampSeconds,
      toSeconds: gain.toTimestampSeconds,
      startWatchRatio: null,
      endWatchRatio: null,
      delta: gain.watchRatioGain,
      relativePerformance: null,
      steepness: null,
      isAbnormallySteep: null,
      outOfRange: false,
      analysisFromSeconds: analysisWindow?.fromSeconds ?? null,
      analysisToSeconds: analysisWindow?.toSeconds ?? null,
    })
  })

  return windows
}

// Loads a video's persisted retention windows, ordered by kind then index.
export async function getRetentionWindows(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<PersistedRetentionWindow[]> {
  const { data, error } = await supabase
    .from("retention_windows")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("kind", { ascending: true })
    .order("window_index", { ascending: true })

  if (error) {
    throw new Error(`Failed to load retention windows: ${error.message}`)
  }

  return ((data ?? []) as RetentionWindowRow[]).map(mapRow)
}

// Replaces a video's retention windows with `windows`. Upserts the new rows on
// (analysed_video_id, kind, window_index), then prunes any rows a previous save
// left behind — a re-analysis can yield fewer windows of a given kind, or none.
// Returns the upserted rows (with their ids) so the caller can attach the
// per-chunk snapshot/audio rows to them.
export async function saveRetentionWindows(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: RetentionWindow[],
): Promise<PersistedRetentionWindow[]> {
  const rows = windows.map((window) => ({
    analysed_video_id: analysedVideoId,
    user_id: userId,
    kind: window.kind,
    window_index: window.windowIndex,
    window_key: window.windowKey,
    label: window.label,
    from_seconds: window.fromSeconds,
    to_seconds: window.toSeconds,
    start_watch_ratio: window.startWatchRatio,
    end_watch_ratio: window.endWatchRatio,
    delta: window.delta,
    relative_performance: window.relativePerformance,
    steepness: window.steepness,
    is_abnormally_steep: window.isAbnormallySteep,
    out_of_range: window.outOfRange,
    analysis_from_seconds: window.analysisFromSeconds,
    analysis_to_seconds: window.analysisToSeconds,
  }))

  let saved: PersistedRetentionWindow[] = []
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("retention_windows")
      .upsert(rows, { onConflict: "analysed_video_id,kind,window_index" })
      .select(COLUMNS)

    if (error) {
      throw new Error(`Failed to save retention windows: ${error.message}`)
    }
    saved = ((data ?? []) as RetentionWindowRow[]).map(mapRow)
  }

  // Remove only the stale trailing rows per kind after the replacement succeeds.
  // A kind with zero new windows deletes all of its old rows (window_index >= 0).
  for (const kind of KINDS) {
    const count = rows.filter((row) => row.kind === kind).length
    const { error } = await supabase
      .from("retention_windows")
      .delete()
      .eq("user_id", userId)
      .eq("analysed_video_id", analysedVideoId)
      .eq("kind", kind)
      .gte("window_index", count)

    if (error) {
      throw new Error(
        `Failed to remove stale retention windows: ${error.message}`,
      )
    }
  }

  return saved
}
