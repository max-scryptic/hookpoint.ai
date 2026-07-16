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

import { selectDeepAnalysisWindows } from "@/lib/deep-analysis-window-selection"
import type { SceneCut, SceneCueScanResult } from "@/lib/media/scene-detection"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import { getDeepAnalysisMaxWindows } from "@/lib/retention-window-media-config"

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
  // Deterministic (no LLM) on-screen text recognized via tesseract.js at
  // extraction time (see lib/media/ocr.ts) — null if recognition failed or
  // the frame had no text confidently readable.
  ocrText: string | null
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
  ocr_text: string | null
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
  "id, retention_window_id, chunk_index, timestamp_seconds, storage_path, status, error, ocr_text, analysis_status, analysis, analysis_error"
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
    ocrText: row.ocr_text,
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

// Samples [fromSeconds, toSeconds] at a global grid of stepSeconds-wide
// gridlines (multiples of stepSeconds measured from 0, not from fromSeconds),
// always including the window's own start and end — e.g.
// buildChunkTimestamps(0, 30) => [0, 5, 10, 15, 20, 25, 30].
//
// Snapping the interior samples to a *global* phase rather than stepping from
// fromSeconds is deliberate: when two overlapping windows both fall back to
// this grid (hook delivery at 10-30 and a drop-off at 7.4-47.4, say), a
// from-relative grid would land them on interleaved-but-distinct seconds (…,20,25 vs
// …,22.4,27.4) so nothing is shared, whereas a global grid puts both on the
// same 10,15,20,25 gridlines across their shared span. That lets the
// extraction frame cache (keyed on the exact timestamp, see
// lib/retention-window-media-extraction.ts) grab each shared second once
// instead of once per window. The raw start/end are still included so edge
// coverage isn't lost when the bounds aren't grid-aligned.
export function buildChunkTimestamps(
  fromSeconds: number,
  toSeconds: number,
  stepSeconds: number = CHUNK_STEP_SECONDS,
): number[] {
  if (toSeconds <= fromSeconds) return [round(fromSeconds)]

  const timestamps = new Set<number>([round(fromSeconds), round(toSeconds)])
  const firstGridline = Math.ceil(fromSeconds / stepSeconds) * stepSeconds
  for (let t = firstGridline; t < toSeconds; t += stepSeconds) {
    timestamps.add(round(t))
  }
  return [...timestamps].sort((a, b) => a - b)
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
  const selectedWindows = selectDeepAnalysisWindows(
    windows,
    getDeepAnalysisMaxWindows(),
  )
  const selectedIds = new Set(selectedWindows.map((window) => window.id))

  for (const window of selectedWindows) {
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
    .filter((window) => !selectedIds.has(window.id))
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

// Minimum spacing between two detected cuts before both keep their own flanking
// pair; cuts closer than this are collapsed to the first, contributing a single
// pair between them. Set to twice the flanking offset so retained cuts have
// non-overlapping flanking windows: at 2×offset, one cut's `+offset` frame and
// the next cut's `-offset` frame no longer coincide or invert. Real edits
// rarely arrive in sub-2s bursts, but ffmpeg's scene detector can fire two or
// three "cuts" within a second on ordinary within-shot motion (a talking head
// tilting or leaning), which would otherwise multiply into a wall of
// near-duplicate frames straddling transitions that never happened. A genuine
// fast-cut montage still survives — its cuts are thinned to one per 2s window
// and then spread by subsampleEvenly, rather than dropped.
const CUT_CLUSTER_MIN_SEPARATION_SECONDS = 2 * CUT_SNAPSHOT_OFFSET_SECONDS

// Keeps a cut only when it is at least CUT_CLUSTER_MIN_SEPARATION_SECONDS past
// the previous kept cut, discarding the tightly-clustered runs a slightly
// over-sensitive scene detector produces on within-shot motion. Assumes the
// input is sorted ascending (the caller sorts before flanking).
export function collapseClusteredCuts(
  cuts: SceneCut[],
  minSeparationSeconds: number = CUT_CLUSTER_MIN_SEPARATION_SECONDS,
): SceneCut[] {
  const kept: SceneCut[] = []
  let lastKept = -Infinity
  for (const cut of cuts) {
    if (cut.atSeconds - lastKept >= minSeparationSeconds) {
      kept.push(cut)
      lastKept = cut.atSeconds
    }
  }
  return kept
}

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
// a blind uniform grid: one frame per *scene segment* the cuts carve the
// window into, each placed just off a real transition rather than at an
// arbitrary 5-second mark that might miss every cut entirely.
//
// N detected cuts split the window into N+1 segments, and each segment is a
// single shot (no cut falls inside it, by definition), so one frame is enough
// visual evidence for it — a second would just hand the vision model a
// near-duplicate. That's why we don't flank *every* cut with a before-and-
// after pair: doing so double-samples each interior segment, because the frame
// just after cut i and the frame just before cut i+1 both land in the same
// static stretch between them (the shot that cut i opened). Instead: one
// leading frame just before the first cut for the head segment, then one frame
// just after each cut for the segment that cut opens. A lone cut still yields
// a true flanking pair (before it and after it); the dedup only trims the
// redundant mid-segment twins that appear once there are two or more cuts.
//
// How a window with *no* detected cuts is sampled depends on why it has none:
//   • The scan ran and confidently found no cuts — a genuinely static shot (a
//     talking head against a fixed background). One frame from the start of
//     the window is enough visual evidence: the shot never changes, so extra
//     frames would just hand the vision model near-duplicates.
//   • The scan *failed* (scanFailed) — content is unknown, so hedge with the
//     dense fixed grid (buildChunkTimestamps) rather than under-sampling a
//     window that might actually contain cuts the scan never got to see.
export function buildSnapshotTimestampsFromSceneCues(
  fromSeconds: number,
  toSeconds: number,
  cues: SceneCueScanResult,
  scanFailed = false,
): number[] {
  if (cues.cuts.length === 0) {
    return scanFailed
      ? buildChunkTimestamps(fromSeconds, toSeconds)
      : [round(fromSeconds)]
  }

  // Collapse tightly-clustered cuts before sampling so a burst of near-
  // simultaneous detections (usually within-shot motion the scene detector
  // over-read as several cuts) contributes one segment boundary, not one per
  // detection. Sort first: collapseClusteredCuts assumes ascending order, and
  // ffmpeg reports cuts in time order but the caller shouldn't rely on it.
  const cuts = collapseClusteredCuts(
    [...cues.cuts].sort((a, b) => a.atSeconds - b.atSeconds),
  )

  // One frame per segment: a leading frame just before the first cut (the head
  // segment), then one frame just after each cut (the segment that cut opens).
  // A Set still dedupes the boundary frame shared by two cuts exactly
  // 2×offset apart.
  const timestamps = new Set<number>()
  timestamps.add(
    round(Math.max(fromSeconds, cuts[0].atSeconds - CUT_SNAPSHOT_OFFSET_SECONDS)),
  )
  for (const cut of cuts) {
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
  scanFailed = false,
): Promise<void> {
  const timestamps = buildSnapshotTimestampsFromSceneCues(
    fromSeconds,
    toSeconds,
    cues,
    scanFailed,
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

// Loads every snapshot row for a video regardless of status — used by event
// synthesis (lib/retention-window-event-synthesis.ts) to check whether every
// snapshot in a window has finished analysis (ready or failed) before
// synthesizing that window's events.
export async function getRetentionWindowSnapshotsForVideo(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowSnapshot[]> {
  const { data, error } = await supabase
    .from("retention_window_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("retention_window_id", { ascending: true })
    .order("chunk_index", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to load retention window snapshots: ${error.message}`,
    )
  }

  return ((data ?? []) as SnapshotRow[]).map(mapSnapshotRow)
}

// Loads every audio row for a video regardless of status — same purpose as
// getRetentionWindowSnapshotsForVideo, for the audio side.
export async function getRetentionWindowAudioForVideo(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowAudioClip[]> {
  const { data, error } = await supabase
    .from("retention_window_audio")
    .select(AUDIO_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(`Failed to load retention window audio: ${error.message}`)
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

// Marks a single snapshot row 'ready' with its storage path and recognized
// OCR text (null if recognition found nothing confident), or 'failed' with an
// error message. Scoped to its owner.
export async function updateRetentionWindowSnapshotStatus(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "ready"; storagePath: string; ocrText: string | null }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? {
          status: "ready",
          storage_path: outcome.storagePath,
          ocr_text: outcome.ocrText,
          error: null,
        }
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
