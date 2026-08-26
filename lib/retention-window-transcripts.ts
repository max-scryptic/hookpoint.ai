// Read/write helpers for the `retention_window_transcripts` table - the
// transcript text spoken during a retention window's padded analysis range
// (analysisFromSeconds/analysisToSeconds, computed alongside the window
// itself in lib/retention-windows.ts).
//
// Unlike retention_window_snapshots/audio, there's no extraction step to wait
// on: the full transcript is already in hand (fetched from the YouTube
// captions API) by the time retention windows are saved, so the clipped text
// is derived and written immediately rather than starting 'pending'.

import type { SupabaseClient } from "@supabase/supabase-js"

import { selectDeepAnalysisWindows } from "@/lib/deep-analysis-window-selection"
import { getDeepAnalysisMaxWindows } from "@/lib/retention-window-media-config"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import type { WindowTranscriptTaxonomy } from "@/lib/retention-window-transcript-taxonomy"
import { transcriptForSegment, type TranscriptCue } from "@/lib/youtube/youtube"

// The per-window transcript taxonomy lifecycle (see
// lib/retention-window-transcript-taxonomy.ts). null means "not part of deep
// analysis" - the resting state for windows deep analysis did not select.
export type RetentionWindowTaxonomyStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "skipped"

export interface RetentionWindowTranscript {
  id: string
  retentionWindowId: string
  fromSeconds: number
  toSeconds: number
  transcript: string
  taxonomyStatus: RetentionWindowTaxonomyStatus | null
  taxonomy: WindowTranscriptTaxonomy | null
  taxonomyError: string | null
  taxonomyModel: string | null
}

interface TranscriptRow {
  id: string
  retention_window_id: string
  from_seconds: number
  to_seconds: number
  transcript: string
  taxonomy_status: RetentionWindowTaxonomyStatus | null
  taxonomy: WindowTranscriptTaxonomy | null
  taxonomy_error: string | null
  taxonomy_model: string | null
}

const COLUMNS =
  "id, retention_window_id, from_seconds, to_seconds, transcript, taxonomy_status, taxonomy, taxonomy_error, taxonomy_model"

// A claimed 'processing' row older than this is treated as abandoned (its
// invocation died mid-call) and eligible to be re-claimed - the same staleness
// tolerance the media analysis claims use.
const TAXONOMY_CLAIM_STALE_MS = 10 * 60 * 1000

function mapRow(row: TranscriptRow): RetentionWindowTranscript {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    transcript: row.transcript,
    taxonomyStatus: row.taxonomy_status,
    taxonomy: row.taxonomy,
    taxonomyError: row.taxonomy_error,
    taxonomyModel: row.taxonomy_model,
  }
}

// Clips `cues` to each window's analysisFromSeconds/analysisToSeconds and
// upserts the resulting text, one row per window. Windows with no analysis
// window (null bounds - see computeAnalysisWindow) are skipped, and any row a
// previous save left behind for them is removed - mirroring how
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

  // Only the bounded deep-analysis set gets a per-window transcript taxonomy -
  // the same selection (over the same passed windows) that
  // createPendingRetentionWindowAudio uses to gate media harvest, so a window
  // gets a transcript taxonomy exactly when it also gets snapshots/audio. Every
  // other window's row keeps taxonomy_status null ("not part of deep analysis").
  const selectedWindowIds = new Set(
    selectDeepAnalysisWindows(windows, getDeepAnalysisMaxWindows()).map(
      (window) => window.id,
    ),
  )

  for (const window of windows) {
    if (
      window.analysisFromSeconds == null ||
      window.analysisToSeconds == null
    ) {
      windowIdsWithoutAnalysisWindow.push(window.id)
      continue
    }

    // Re-writing a window's clipped text (a re-analysis whose range may have
    // shifted) resets its taxonomy: pending again for a selected window, cleared
    // for a deselected one, and the stale JSON/error/model dropped either way so
    // a previous run's read can never outlive the text it was generated from.
    const selected = selectedWindowIds.has(window.id)
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
      taxonomy_status: selected ? "pending" : null,
      taxonomy: null,
      taxonomy_error: null,
      taxonomy_model: null,
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

// Re-pends the per-window transcript taxonomy for a fresh deep-analysis run,
// without touching the transcript text itself (which light analysis owns and
// this pipeline must leave alone). Selected windows go back to 'pending' with
// any prior taxonomy/error/model cleared; deselected windows are set null. Used
// by the "retry deep analysis" reset, which clears the other deep tables but
// deliberately keeps the transcripts table.
export async function rependRetentionWindowTranscriptTaxonomies(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: PersistedRetentionWindow[],
): Promise<void> {
  const selectedWindowIds = selectDeepAnalysisWindows(
    windows,
    getDeepAnalysisMaxWindows(),
  ).map((window) => window.id)

  // Clear every window's taxonomy first (a window deselected since the last run
  // must not keep a stale 'ready'), then pend the selected set.
  const clear = await supabase
    .from("retention_window_transcripts")
    .update({
      taxonomy_status: null,
      taxonomy: null,
      taxonomy_error: null,
      taxonomy_model: null,
    })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
  if (clear.error) {
    throw new Error(
      `Failed to clear retention window transcript taxonomies: ${clear.error.message}`,
    )
  }

  if (selectedWindowIds.length === 0) return

  const pend = await supabase
    .from("retention_window_transcripts")
    .update({ taxonomy_status: "pending" })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .in("retention_window_id", selectedWindowIds)
  if (pend.error) {
    throw new Error(
      `Failed to re-pend retention window transcript taxonomies: ${pend.error.message}`,
    )
  }
}

// Atomically claims every window transcript row awaiting a taxonomy for this
// video (taxonomy_status 'pending', or a 'processing' row whose claim went
// stale), flipping it to 'processing' and returning the claimed rows - the same
// update-and-return claim the media analysis uses, so two overlapping pipeline
// triggers can't pay for the same window's taxonomy twice. Runs with the admin
// client from the deep-analysis pipeline.
export async function claimRetentionWindowTranscriptsPendingTaxonomy(
  admin: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowTranscript[]> {
  const staleBefore = new Date(
    Date.now() - TAXONOMY_CLAIM_STALE_MS,
  ).toISOString()

  const { data, error } = await admin
    .from("retention_window_transcripts")
    .update({ taxonomy_status: "processing" })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .or(
      `taxonomy_status.eq.pending,and(taxonomy_status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select(COLUMNS)
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to claim retention window transcripts for taxonomy: ${error.message}`,
    )
  }

  return ((data ?? []) as TranscriptRow[]).map(mapRow)
}

// Records the outcome of one window's taxonomy generation. 'ready' stores the
// taxonomy JSON and the model that produced it; 'failed' stores the error;
// 'skipped' settles a window whose transcript was empty (nothing to read). Each
// write clears the fields that don't apply to its status so a retry never leaves
// a stale error next to a fresh result.
export async function updateRetentionWindowTranscriptTaxonomy(
  admin: SupabaseClient,
  userId: string,
  transcriptRowId: string,
  update:
    | { status: "ready"; taxonomy: WindowTranscriptTaxonomy; model: string }
    | { status: "failed"; error: string }
    | { status: "skipped" },
): Promise<void> {
  const patch: Record<string, unknown> = { taxonomy_status: update.status }
  if (update.status === "ready") {
    patch.taxonomy = update.taxonomy
    patch.taxonomy_model = update.model
    patch.taxonomy_error = null
  } else if (update.status === "failed") {
    patch.taxonomy_error = update.error
  } else {
    patch.taxonomy = null
    patch.taxonomy_error = null
    patch.taxonomy_model = null
  }

  const { error } = await admin
    .from("retention_window_transcripts")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", transcriptRowId)

  if (error) {
    throw new Error(
      `Failed to update retention window transcript taxonomy: ${error.message}`,
    )
  }
}
