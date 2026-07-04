// Read/write helpers for `retention_window_event_synthesis` and
// `retention_window_events` — the cross-modal, timestamped, narrated events
// a text-only LLM call synthesizes per window from evidence that's already
// been computed (retention delta, transcript, scene-cue metrics, per-snapshot
// vision analysis, audio analysis). See
// lib/retention-window-event-synthesis.ts for the call itself.
//
// Mirrors retention_window_scene_cue_scans' per-window job-status shape
// (pending/ready/failed, same stale-failure retry) since this is the same
// kind of one-job-per-window pipeline stage, just producing narrated events
// instead of raw cue timestamps.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PersistedRetentionWindow } from "@/lib/retention-windows"

export type EventSynthesisStatus = "pending" | "processing" | "ready" | "failed"

export interface RetentionWindowEventSynthesisJob {
  id: string
  retentionWindowId: string
  status: EventSynthesisStatus
  error: string | null
}

interface EventSynthesisRow {
  id: string
  retention_window_id: string
  status: EventSynthesisStatus
  error: string | null
}

const SYNTHESIS_COLUMNS = "id, retention_window_id, status, error"

function mapSynthesisRow(
  row: EventSynthesisRow,
): RetentionWindowEventSynthesisJob {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    status: row.status,
    error: row.error,
  }
}

// Creates the pending event-synthesis job for each of a video's retention
// windows that has an analysis window, one row per window — mirrors
// createPendingRetentionWindowSceneCueScans. The job itself doesn't run
// until its window's scene-cue scan, every snapshot, and its audio clip have
// all settled (see synthesizeRetentionWindowEvents), but the row can be
// created immediately, the same as those two.
export async function createPendingRetentionWindowEventSynthesis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  windows: PersistedRetentionWindow[],
): Promise<void> {
  const rows: Record<string, unknown>[] = []
  const windowIdsWithoutAnalysisWindow: string[] = []

  for (const window of windows) {
    if (window.analysisFromSeconds == null || window.analysisToSeconds == null) {
      windowIdsWithoutAnalysisWindow.push(window.id)
      continue
    }

    rows.push({
      retention_window_id: window.id,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      status: "pending",
      error: null,
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("retention_window_event_synthesis")
      .upsert(rows, { onConflict: "retention_window_id" })

    if (error) {
      throw new Error(
        `Failed to save event synthesis jobs: ${error.message}`,
      )
    }
  }

  if (windowIdsWithoutAnalysisWindow.length > 0) {
    const { error } = await supabase
      .from("retention_window_event_synthesis")
      .delete()
      .eq("user_id", userId)
      .in("retention_window_id", windowIdsWithoutAnalysisWindow)

    if (error) {
      throw new Error(
        `Failed to remove stale event synthesis jobs: ${error.message}`,
      )
    }
  }
}

// A failed job older than this is retried automatically, the same
// stale-failure tolerance getPendingRetentionWindowSceneCueScans uses — a
// transient failure (an OpenAI outage, a malformed response) shouldn't
// permanently strand a window without events.
const SYNTHESIS_RETRY_STALE_MS = 10 * 60 * 1000

// Atomically claims every event-synthesis job ready to (re)run for a video.
// The processing lease prevents overlapping progress polls / pipeline
// callbacks from issuing duplicate OpenAI calls. A worker that is terminated
// mid-call is recovered once its claim becomes stale.
export async function claimPendingRetentionWindowEventSynthesisJobs(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowEventSynthesisJob[]> {
  const staleBefore = new Date(
    Date.now() - SYNTHESIS_RETRY_STALE_MS,
  ).toISOString()

  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .update({ status: "processing", error: null })
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .or(
      `status.eq.pending,and(status.eq.failed,updated_at.lt.${staleBefore}),and(status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select(SYNTHESIS_COLUMNS)
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(`Failed to claim pending event synthesis jobs: ${error.message}`)
  }

  return ((data ?? []) as EventSynthesisRow[]).map(mapSynthesisRow)
}

export async function updateRetentionWindowEventSynthesisStatus(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome:
    | { status: "pending" }
    | { status: "ready"; model: string }
    | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "pending"
      ? { status: "pending", error: null }
      : outcome.status === "ready"
      ? {
          status: "ready",
          error: null,
          model: outcome.model,
          synthesized_at: new Date().toISOString(),
        }
      : { status: "failed", error: outcome.error }

  const { error } = await supabase
    .from("retention_window_event_synthesis")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to update event synthesis job: ${error.message}`)
  }
}

export type RetentionWindowEventType =
  | "scene_cut"
  | "topic_shift"
  | "visual_change"
  | "audio_change"
  | "pacing_change"
  | "on_screen_text_change"
  | "other"

export type RetentionWindowEventPrimaryEvidence =
  | "editing"
  | "visual"
  | "audio"
  | "transcript"
  | "combined"

export interface SynthesizedEvent {
  eventType: RetentionWindowEventType
  timestampSeconds: number
  narrative: string
  primaryEvidence: RetentionWindowEventPrimaryEvidence
}

export interface RetentionWindowEvent extends SynthesizedEvent {
  id: string
  retentionWindowId: string
  eventIndex: number
}

interface RetentionWindowEventRow {
  id: string
  retention_window_id: string
  event_index: number
  event_type: RetentionWindowEventType
  timestamp_seconds: number
  narrative: string
  primary_evidence: RetentionWindowEventPrimaryEvidence
}

const EVENT_COLUMNS =
  "id, retention_window_id, event_index, event_type, timestamp_seconds, narrative, primary_evidence"

function mapEventRow(row: RetentionWindowEventRow): RetentionWindowEvent {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    eventIndex: row.event_index,
    eventType: row.event_type,
    timestampSeconds: row.timestamp_seconds,
    narrative: row.narrative,
    primaryEvidence: row.primary_evidence,
  }
}

// Replaces a window's previously-synthesized events with a fresh set. A full
// replace (not an upsert) for the same reason replaceRetentionWindowSceneCues
// is: individual events have no stable business key to merge on across
// re-synthesis, so a re-run just supersedes the old set outright.
export async function replaceRetentionWindowEvents(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  retentionWindowId: string,
  events: SynthesizedEvent[],
): Promise<void> {
  const rows = events.map((event, eventIndex) => ({
    retention_window_id: retentionWindowId,
    analysed_video_id: analysedVideoId,
    user_id: userId,
    event_index: eventIndex,
    event_type: event.eventType,
    timestamp_seconds: event.timestampSeconds,
    narrative: event.narrative,
    primary_evidence: event.primaryEvidence,
  }))

  const { error: deleteError } = await supabase
    .from("retention_window_events")
    .delete()
    .eq("user_id", userId)
    .eq("retention_window_id", retentionWindowId)

  if (deleteError) {
    throw new Error(
      `Failed to clear previous retention window events: ${deleteError.message}`,
    )
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("retention_window_events")
      .insert(rows)

    if (insertError) {
      throw new Error(
        `Failed to save retention window events: ${insertError.message}`,
      )
    }
  }
}

export async function getRetentionWindowEvents(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowEvent[]> {
  const { data, error } = await supabase
    .from("retention_window_events")
    .select(EVENT_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("retention_window_id", { ascending: true })
    .order("event_index", { ascending: true })

  if (error) {
    throw new Error(`Failed to load retention window events: ${error.message}`)
  }

  return ((data ?? []) as RetentionWindowEventRow[]).map(mapEventRow)
}
