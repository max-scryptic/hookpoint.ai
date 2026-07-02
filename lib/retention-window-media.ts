// Read/write helpers for the `retention_window_snapshots` and
// `retention_window_audio` tables — the per-chunk-timestamp thumbnails and
// per-window audio clips harvested from a retention window's padded analysis
// range (analysisFromSeconds/analysisToSeconds, computed alongside the window
// itself in lib/retention-windows.ts).
//
// Audio rows are created 'pending' as soon as a retention window is saved —
// the range is known immediately, independent of whether the source video
// has been uploaded yet. Snapshot rows are different: their timestamps are
// derived from the window's scene-cue scan (see
// buildSnapshotTimestampsFromSceneCues below), which only runs once the
// source video is readable, so they're created later, during extraction
// (lib/retention-window-media-extraction.ts) rather than up front here. Both
// flip to 'ready' or 'failed' once extraction actually runs. AI analysis of
// the harvested media is a later step, not handled here.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

export const CHUNK_STEP_SECONDS = 5

export type RetentionWindowMediaStatus = "pending" | "ready" | "failed"

// 'processing' only ever applies to analysisStatus: it's a claim a caller
// holds while it's mid-LLM-call for a row, not a real extraction/analysis
// outcome. See claimRetentionWindowSnapshotsPendingAnalysis below.
export type RetentionWindowAnalysisStatus = RetentionWindowMediaStatus | "processing"

export interface RetentionWindowSnapshot {
  id: string
  retentionWindowId: string
  chunkIndex: number
  timestampSeconds: number
  storagePath: string | null
  status: RetentionWindowMediaStatus
  error: string | null
  analysisStatus: RetentionWindowAnalysisStatus
  analysis: unknown
  analysisError: string | null
}

export interface RetentionWindowAudioClip {
  id: string
  retentionWindowId: string
  fromSeconds: number
  toSeconds: number
  storagePath: string | null
  status: RetentionWindowMediaStatus
  error: string | null
  analysisStatus: RetentionWindowAnalysisStatus
  analysis: unknown
  analysisError: string | null
}

interface SnapshotRow {
  id: string
  retention_window_id: string
  chunk_index: number
  timestamp_seconds: number
  storage_path: string | null
  status: RetentionWindowMediaStatus
  error: string | null
  analysis_status: RetentionWindowAnalysisStatus
  analysis: unknown
  analysis_error: string | null
}

interface AudioRow {
  id: string
  retention_window_id: string
  from_seconds: number
  to_seconds: number
  storage_path: string | null
  status: RetentionWindowMediaStatus
  error: string | null
  analysis_status: RetentionWindowAnalysisStatus
  analysis: unknown
  analysis_error: string | null
}

const SNAPSHOT_COLUMNS =
  "id, retention_window_id, chunk_index, timestamp_seconds, storage_path, status, error, analysis_status, analysis, analysis_error"
const AUDIO_COLUMNS =
  "id, retention_window_id, from_seconds, to_seconds, storage_path, status, error, analysis_status, analysis, analysis_error"

function mapSnapshotRow(row: SnapshotRow): RetentionWindowSnapshot {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    chunkIndex: row.chunk_index,
    timestampSeconds: row.timestamp_seconds,
    storagePath: row.storage_path,
    status: row.status,
    error: row.error,
    analysisStatus: row.analysis_status,
    analysis: row.analysis,
    analysisError: row.analysis_error,
  }
}

function mapAudioRow(row: AudioRow): RetentionWindowAudioClip {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    storagePath: row.storage_path,
    status: row.status,
    error: row.error,
    analysisStatus: row.analysis_status,
    analysis: row.analysis,
    analysisError: row.analysis_error,
  }
}

// Splits [fromSeconds, toSeconds] into stepSeconds-wide chunk timestamps,
// starting at fromSeconds and always including toSeconds as the final point —
// e.g. buildChunkTimestamps(0, 30) => [0, 5, 10, 15, 20, 25, 30]. When the span
// isn't an exact multiple of the step, the last gap is shorter than the rest
// rather than overshooting toSeconds.
export function buildChunkTimestamps(
  fromSeconds: number,
  toSeconds: number,
  stepSeconds: number = CHUNK_STEP_SECONDS,
): number[] {
  if (toSeconds <= fromSeconds) return [round(fromSeconds)]

  const timestamps: number[] = []
  let t = fromSeconds
  while (t < toSeconds) {
    timestamps.push(round(t))
    t += stepSeconds
  }
  timestamps.push(round(toSeconds))
  return timestamps
}

// Rounds away floating-point noise (e.g. 22.299999999999997) without losing
// meaningful sub-second precision.
function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

// Creates the pending audio row for each of a video's retention windows that
// has an analysis window (null bounds — see computeAnalysisWindow — are
// skipped entirely), one row per window, from its
// analysisFromSeconds/analysisToSeconds. Snapshot rows are *not* created
// here — their timestamps depend on that window's scene-cue scan, which only
// runs once the source video is readable (see
// createRetentionWindowSnapshotsFromSceneCues below, called from
// lib/retention-window-media-extraction.ts).
//
// Always resets status to 'pending' on upsert (never merges into an existing
// 'ready'/'failed' row's status): a fresh analyze recomputes the retention
// curve, so a window's range can shift between runs, and a previously
// harvested audio clip captured at the old range would otherwise be left
// claiming 'ready' for a range it no longer matches.
export async function createPendingRetentionWindowAudio(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: PersistedRetentionWindow[],
): Promise<void> {
  const audioRows: Record<string, unknown>[] = []

  for (const window of windows) {
    if (
      window.analysisFromSeconds == null ||
      window.analysisToSeconds == null
    ) {
      continue
    }

    audioRows.push({
      retention_window_id: window.id,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      from_seconds: window.analysisFromSeconds,
      to_seconds: window.analysisToSeconds,
      status: "pending",
      storage_path: null,
      error: null,
    })
  }

  if (audioRows.length > 0) {
    const { error } = await supabase
      .from("retention_window_audio")
      .upsert(audioRows, { onConflict: "retention_window_id" })

    if (error) {
      throw new Error(`Failed to save retention window audio: ${error.message}`)
    }
  }

  // A window that lost its analysis window entirely also loses its audio row.
  const windowIdsWithoutAnalysisWindow = windows
    .filter((w) => w.analysisFromSeconds == null || w.analysisToSeconds == null)
    .map((w) => w.id)
  if (windowIdsWithoutAnalysisWindow.length > 0) {
    const { error } = await supabase
      .from("retention_window_audio")
      .delete()
      .eq("user_id", userId)
      .in("retention_window_id", windowIdsWithoutAnalysisWindow)

    if (error) {
      throw new Error(
        `Failed to remove stale retention window audio: ${error.message}`,
      )
    }
  }
}

// How far before/after a detected hard cut to place the two flanking
// snapshots — small enough to land clearly on either side of the transition
// without ffmpeg's seek landing on the same frame for both.
const CUT_SNAPSHOT_OFFSET_SECONDS = 1

// Ceiling on how many snapshots one window can produce. A window with an
// unusually high cut rate (a fast-cut montage) would otherwise generate one
// flanking pair per cut and blow past what's worth extracting/storing/
// sending to the vision model; subsampling evenly keeps coverage spread
// across the whole window instead of just its first few cuts.
const MAX_SNAPSHOTS_PER_WINDOW = 12

function subsampleEvenly(values: number[], max: number): number[] {
  if (values.length <= max) return values
  const step = (values.length - 1) / (max - 1)
  const picked = new Set<number>()
  for (let i = 0; i < max; i++) {
    picked.add(values[Math.round(i * step)])
  }
  return [...picked].sort((a, b) => a - b)
}

// Derives a window's snapshot timestamps from its scene-cue scan instead of
// a blind uniform grid: two flanking frames — just before and just after —
// per detected hard cut, so the harvested images actually straddle a real
// transition instead of landing at an arbitrary 5-second mark that might
// miss every cut in the window entirely. Falls back to the original
// fixed-step grid when a window has no detected cuts at all (e.g. a static
// talking-head shot), so it still gets some visual evidence rather than none.
export function buildSnapshotTimestampsFromSceneCues(
  fromSeconds: number,
  toSeconds: number,
  cues: SceneCueScanResult,
): number[] {
  if (cues.cuts.length === 0) {
    return buildChunkTimestamps(fromSeconds, toSeconds)
  }

  const timestamps = new Set<number>()
  for (const cut of cues.cuts) {
    timestamps.add(
      round(Math.max(fromSeconds, cut.atSeconds - CUT_SNAPSHOT_OFFSET_SECONDS)),
    )
    timestamps.add(
      round(Math.min(toSeconds, cut.atSeconds + CUT_SNAPSHOT_OFFSET_SECONDS)),
    )
  }

  return subsampleEvenly(
    [...timestamps].sort((a, b) => a - b),
    MAX_SNAPSHOTS_PER_WINDOW,
  )
}

// Creates one window's snapshot rows from its scene-cue scan result, once the
// scan itself has completed. Always resets status to 'pending' on upsert, the
// same don't-merge-into-'ready' reasoning createPendingRetentionWindowAudio
// uses: a re-scan can shift cut positions, and a previously harvested
// thumbnail at the old timestamp would otherwise be left claiming 'ready' for
// a moment it no longer matches. Also prunes any trailing chunk rows a
// previous (larger) scan of this window left behind.
export async function createRetentionWindowSnapshotsFromSceneCues(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  retentionWindowId: string,
  fromSeconds: number,
  toSeconds: number,
  cues: SceneCueScanResult,
): Promise<void> {
  const timestamps = buildSnapshotTimestampsFromSceneCues(
    fromSeconds,
    toSeconds,
    cues,
  )

  const rows = timestamps.map((timestampSeconds, chunkIndex) => ({
    retention_window_id: retentionWindowId,
    analysed_video_id: analysedVideoId,
    user_id: userId,
    chunk_index: chunkIndex,
    timestamp_seconds: timestampSeconds,
    status: "pending",
    storage_path: null,
    error: null,
  }))

  const { error } = await supabase
    .from("retention_window_snapshots")
    .upsert(rows, { onConflict: "retention_window_id,chunk_index" })

  if (error) {
    throw new Error(`Failed to save retention window snapshots: ${error.message}`)
  }

  const { error: pruneError } = await supabase
    .from("retention_window_snapshots")
    .delete()
    .eq("user_id", userId)
    .eq("retention_window_id", retentionWindowId)
    .gte("chunk_index", rows.length)

  if (pruneError) {
    throw new Error(
      `Failed to remove stale retention window snapshots: ${pruneError.message}`,
    )
  }
}

// Loads every pending snapshot for a video, ordered so a partial extraction
// run resumes chunk-by-chunk in a stable order.
export async function getPendingRetentionWindowSnapshots(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowSnapshot[]> {
  const { data, error } = await supabase
    .from("retention_window_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "pending")
    .order("retention_window_id", { ascending: true })
    .order("chunk_index", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to load pending retention window snapshots: ${error.message}`,
    )
  }

  return ((data ?? []) as SnapshotRow[]).map(mapSnapshotRow)
}

// Loads every pending audio clip for a video.
export async function getPendingRetentionWindowAudio(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowAudioClip[]> {
  const { data, error } = await supabase
    .from("retention_window_audio")
    .select(AUDIO_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "pending")
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to load pending retention window audio: ${error.message}`,
    )
  }

  return ((data ?? []) as AudioRow[]).map(mapAudioRow)
}

// True when a video has any snapshot or audio row still waiting on
// extraction. Used to decide whether it's worth kicking off a run at all.
export async function hasPendingRetentionWindowMedia(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("retention_window_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "pending")

  if (error) {
    throw new Error(
      `Failed to check for pending retention window media: ${error.message}`,
    )
  }

  return (count ?? 0) > 0
}

// Marks a single snapshot row 'ready' with its storage path, or 'failed' with
// an error message. Scoped to its owner.
export async function updateRetentionWindowSnapshotStatus(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "ready"; storagePath: string }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? { status: "ready", storage_path: outcome.storagePath, error: null }
      : { status: "failed", error: outcome.error }

  const { error } = await supabase
    .from("retention_window_snapshots")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to update retention window snapshot: ${error.message}`,
    )
  }
}

// Marks a single audio row 'ready' with its storage path, or 'failed' with an
// error message. Scoped to its owner.
export async function updateRetentionWindowAudioStatus(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "ready"; storagePath: string }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? { status: "ready", storage_path: outcome.storagePath, error: null }
      : { status: "failed", error: outcome.error }

  const { error } = await supabase
    .from("retention_window_audio")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to update retention window audio: ${error.message}`)
  }
}

// A claim older than this is treated as abandoned (the caller was almost
// certainly killed by a function timeout mid-call) and can be reclaimed by
// the next trigger, rather than blocking analysis forever.
const ANALYSIS_CLAIM_STALE_MS = 10 * 60 * 1000

// Atomically claims every successfully-extracted snapshot still waiting on
// analysis by flipping analysis_status pending -> processing in one UPDATE,
// so two triggers running at once can't both pick up the same row and call
// the LLM twice for it: the UPDATE's WHERE clause only matches a row once,
// whichever caller's statement commits first. Returns just the rows this
// call actually claimed, ordered so a batch call can group consecutive rows
// by window.
export async function claimRetentionWindowSnapshotsPendingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowSnapshot[]> {
  const staleBefore = new Date(Date.now() - ANALYSIS_CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("retention_window_snapshots")
    .update({ analysis_status: "processing" })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "ready")
    .or(
      `analysis_status.eq.pending,and(analysis_status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select(SNAPSHOT_COLUMNS)
    .order("retention_window_id", { ascending: true })
    .order("chunk_index", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to claim retention window snapshots for analysis: ${error.message}`,
    )
  }

  return ((data ?? []) as SnapshotRow[]).map(mapSnapshotRow)
}

// Same claim as above, for audio clips.
export async function claimRetentionWindowAudioPendingAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowAudioClip[]> {
  const staleBefore = new Date(Date.now() - ANALYSIS_CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("retention_window_audio")
    .update({ analysis_status: "processing" })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "ready")
    .or(
      `analysis_status.eq.pending,and(analysis_status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select(AUDIO_COLUMNS)
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to claim retention window audio for analysis: ${error.message}`,
    )
  }

  return ((data ?? []) as AudioRow[]).map(mapAudioRow)
}

// Marks a single snapshot row's analysis 'ready' with its structured result,
// or 'failed' with an error message. Scoped to its owner.
export async function updateRetentionWindowSnapshotAnalysis(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "ready"; analysis: unknown; model: string }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? {
          analysis_status: "ready",
          analysis: outcome.analysis,
          analysis_model: outcome.model,
          analysis_error: null,
          analyzed_at: new Date().toISOString(),
        }
      : { analysis_status: "failed", analysis_error: outcome.error }

  const { error } = await supabase
    .from("retention_window_snapshots")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to update retention window snapshot analysis: ${error.message}`,
    )
  }
}

// Marks a single audio row's analysis 'ready' with its structured result, or
// 'failed' with an error message. Scoped to its owner.
export async function updateRetentionWindowAudioAnalysis(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "ready"; analysis: unknown; model: string }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? {
          analysis_status: "ready",
          analysis: outcome.analysis,
          analysis_model: outcome.model,
          analysis_error: null,
          analyzed_at: new Date().toISOString(),
        }
      : { analysis_status: "failed", analysis_error: outcome.error }

  const { error } = await supabase
    .from("retention_window_audio")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(
      `Failed to update retention window audio analysis: ${error.message}`,
    )
  }
}
