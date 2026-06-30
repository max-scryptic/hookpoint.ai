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
}

interface RetentionWindowRow {
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
}

const COLUMNS =
  "kind, window_index, window_key, label, from_seconds, to_seconds, start_watch_ratio, end_watch_ratio, delta, relative_performance, steepness, is_abnormally_steep, out_of_range"

const KINDS: RetentionWindowKind[] = ["hook", "drop_off", "gain"]

// How many significant mid-video drop-offs we surface and store. Matches the
// number the detail view lists under "Biggest drop-offs".
const SIGNIFICANT_DROP_OFF_LIMIT = 4

function mapRow(row: RetentionWindowRow): RetentionWindow {
  return {
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
      })
    },
  )

  detectSignificantDropOffs(retention, {
    limit: SIGNIFICANT_DROP_OFF_LIMIT,
  }).forEach((drop, windowIndex) => {
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
    })
  })

  detectRetentionGains(retention).forEach((gain, windowIndex) => {
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
    })
  })

  return windows
}

// Loads a video's persisted retention windows, ordered by kind then index.
export async function getRetentionWindows(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindow[]> {
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
export async function saveRetentionWindows(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: RetentionWindow[],
): Promise<void> {
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
  }))

  if (rows.length > 0) {
    const { error } = await supabase
      .from("retention_windows")
      .upsert(rows, { onConflict: "analysed_video_id,kind,window_index" })

    if (error) {
      throw new Error(`Failed to save retention windows: ${error.message}`)
    }
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
}
