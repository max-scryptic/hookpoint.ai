// Read/write helpers for the `retention_window_snapshots` and
// `retention_window_audio` tables — the per-chunk-timestamp thumbnails and
// per-window audio clips harvested from a retention window's padded analysis
// range (analysisFromSeconds/analysisToSeconds, computed alongside the window
// itself in lib/retention-windows.ts).
//
// Rows are created 'pending' as soon as a retention window is saved — the
// timestamps/range are known immediately, independent of whether the source
// video has been uploaded yet — and flipped to 'ready' or 'failed' once
// extraction actually runs (lib/retention-window-media-extraction.ts). AI
// analysis of the harvested media is a later step, not handled here.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PersistedRetentionWindow } from "@/lib/retention-windows"

export const CHUNK_STEP_SECONDS = 5

export type RetentionWindowMediaStatus = "pending" | "ready" | "failed"

export interface RetentionWindowSnapshot {
  id: string
  retentionWindowId: string
  chunkIndex: number
  timestampSeconds: number
  storagePath: string | null
  status: RetentionWindowMediaStatus
  error: string | null
}

export interface RetentionWindowAudioClip {
  id: string
  retentionWindowId: string
  fromSeconds: number
  toSeconds: number
  storagePath: string | null
  status: RetentionWindowMediaStatus
  error: string | null
}

interface SnapshotRow {
  id: string
  retention_window_id: string
  chunk_index: number
  timestamp_seconds: number
  storage_path: string | null
  status: RetentionWindowMediaStatus
  error: string | null
}

interface AudioRow {
  id: string
  retention_window_id: string
  from_seconds: number
  to_seconds: number
  storage_path: string | null
  status: RetentionWindowMediaStatus
  error: string | null
}

const SNAPSHOT_COLUMNS =
  "id, retention_window_id, chunk_index, timestamp_seconds, storage_path, status, error"
const AUDIO_COLUMNS =
  "id, retention_window_id, from_seconds, to_seconds, storage_path, status, error"

function mapSnapshotRow(row: SnapshotRow): RetentionWindowSnapshot {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    chunkIndex: row.chunk_index,
    timestampSeconds: row.timestamp_seconds,
    storagePath: row.storage_path,
    status: row.status,
    error: row.error,
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

// Creates the pending snapshot/audio rows for a video's retention windows, one
// snapshot per chunk timestamp plus one audio clip per window, from each
// window's analysisFromSeconds/analysisToSeconds. Windows with no analysis
// window (null bounds — see computeAnalysisWindow) are skipped entirely.
//
// Always resets status to 'pending' on upsert (never merges into an existing
// 'ready'/'failed' row's status): a fresh analyze recomputes the retention
// curve, so a chunk's timestamp can shift between runs, and a previously
// harvested thumbnail/audio clip captured at the old timestamp would otherwise
// be left claiming 'ready' for a timestamp it no longer matches.
export async function createPendingRetentionWindowMedia(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: PersistedRetentionWindow[],
): Promise<void> {
  const snapshotRows: Record<string, unknown>[] = []
  const audioRows: Record<string, unknown>[] = []
  const chunkCountByWindow = new Map<string, number>()

  for (const window of windows) {
    if (
      window.analysisFromSeconds == null ||
      window.analysisToSeconds == null
    ) {
      continue
    }

    const timestamps = buildChunkTimestamps(
      window.analysisFromSeconds,
      window.analysisToSeconds,
    )
    chunkCountByWindow.set(window.id, timestamps.length)

    timestamps.forEach((timestampSeconds, chunkIndex) => {
      snapshotRows.push({
        retention_window_id: window.id,
        analysed_video_id: analysedVideoId,
        user_id: userId,
        chunk_index: chunkIndex,
        timestamp_seconds: timestampSeconds,
        status: "pending",
        storage_path: null,
        error: null,
      })
    })

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

  if (snapshotRows.length > 0) {
    const { error } = await supabase
      .from("retention_window_snapshots")
      .upsert(snapshotRows, { onConflict: "retention_window_id,chunk_index" })

    if (error) {
      throw new Error(
        `Failed to save retention window snapshots: ${error.message}`,
      )
    }
  }

  if (audioRows.length > 0) {
    const { error } = await supabase
      .from("retention_window_audio")
      .upsert(audioRows, { onConflict: "retention_window_id" })

    if (error) {
      throw new Error(`Failed to save retention window audio: ${error.message}`)
    }
  }

  // Prune stale trailing chunk rows per window — a re-analysis can shrink a
  // window's span (fewer chunks) or drop its analysis window entirely (zero
  // chunks, deleting every row window_index >= 0 previously saved for it).
  for (const window of windows) {
    const count = chunkCountByWindow.get(window.id) ?? 0
    const { error } = await supabase
      .from("retention_window_snapshots")
      .delete()
      .eq("user_id", userId)
      .eq("retention_window_id", window.id)
      .gte("chunk_index", count)

    if (error) {
      throw new Error(
        `Failed to remove stale retention window snapshots: ${error.message}`,
      )
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
