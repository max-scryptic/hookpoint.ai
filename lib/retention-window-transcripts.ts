// Read/write helpers for the `retention_window_transcripts` table — the
// transcript text spoken during a retention window's padded analysis range
// (analysisFromSeconds/analysisToSeconds, computed alongside the window
// itself in lib/retention-windows.ts).
//
// Unlike retention_window_snapshots/audio, there's no extraction step to wait
// on: the full transcript is already in hand (fetched from the YouTube
// captions API) by the time retention windows are saved, so the clipped text
// is derived and written immediately rather than starting 'pending'.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import { transcriptForSegment, type TranscriptCue } from "@/lib/youtube/youtube"

export interface RetentionWindowTranscript {
  id: string
  retentionWindowId: string
  fromSeconds: number
  toSeconds: number
  transcript: string
}

interface TranscriptRow {
  id: string
  retention_window_id: string
  from_seconds: number
  to_seconds: number
  transcript: string
}

const COLUMNS =
  "id, retention_window_id, from_seconds, to_seconds, transcript"

function mapRow(row: TranscriptRow): RetentionWindowTranscript {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    transcript: row.transcript,
  }
}

// Clips `cues` to each window's analysisFromSeconds/analysisToSeconds and
// upserts the resulting text, one row per window. Windows with no analysis
// window (null bounds — see computeAnalysisWindow) are skipped, and any row a
// previous save left behind for them is removed — mirroring how
// createPendingRetentionWindowAudio prunes stale audio rows.
export async function saveRetentionWindowTranscripts(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: PersistedRetentionWindow[],
  cues: TranscriptCue[],
): Promise<void> {
  const rows: Record<string, unknown>[] = []
  const windowIdsWithoutAnalysisWindow: string[] = []

  for (const window of windows) {
    if (
      window.analysisFromSeconds == null ||
      window.analysisToSeconds == null
    ) {
      windowIdsWithoutAnalysisWindow.push(window.id)
      continue
    }

    rows.push({
      retention_window_id: window.id,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      from_seconds: window.analysisFromSeconds,
      to_seconds: window.analysisToSeconds,
      transcript: transcriptForSegment(
        cues,
        window.analysisFromSeconds,
        window.analysisToSeconds,
      ),
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("retention_window_transcripts")
      .upsert(rows, { onConflict: "retention_window_id" })

    if (error) {
      throw new Error(
        `Failed to save retention window transcripts: ${error.message}`,
      )
    }
  }

  if (windowIdsWithoutAnalysisWindow.length > 0) {
    const { error } = await supabase
      .from("retention_window_transcripts")
      .delete()
      .eq("user_id", userId)
      .in("retention_window_id", windowIdsWithoutAnalysisWindow)

    if (error) {
      throw new Error(
        `Failed to remove stale retention window transcripts: ${error.message}`,
      )
    }
  }
}

// Loads a video's retention window transcripts.
export async function getRetentionWindowTranscripts(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowTranscript[]> {
  const { data, error } = await supabase
    .from("retention_window_transcripts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)

  if (error) {
    throw new Error(
      `Failed to load retention window transcripts: ${error.message}`,
    )
  }

  return ((data ?? []) as TranscriptRow[]).map(mapRow)
}
