// Read/write helpers for `retention_window_scene_cue_scans` and
// `video_scene_cues` — the deterministic (non-LLM) cut/freeze/black
// timestamps an ffmpeg pass over a retention window's own analysis range
// produces (lib/media/scene-detection.ts).
//
// Mirrors retention_window_audio's shape (one status row per window,
// pending/ready/failed) since a scene-cue scan is extracted the same way,
// over the same [analysisFromSeconds, analysisToSeconds] span, just
// producing structured timestamps instead of a stored media file. The
// detected events land in video_scene_cues tagged with the window that
// produced them, so cut-count/cuts-per-minute/freeze-and-black coverage for
// any [from, to] range — a window's own span, or an approximate video-wide
// baseline averaged across every window scanned so far — are computed on
// read (see computeSceneCueMetrics/computeAverageSceneCueMetrics below)
// instead of re-scanning per query.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

export type SceneCueScanStatus = "pending" | "ready" | "failed"

export interface RetentionWindowSceneCueScan {
  id: string
  retentionWindowId: string
  fromSeconds: number
  toSeconds: number
  status: SceneCueScanStatus
  error: string | null
}

interface SceneCueScanRow {
  id: string
  retention_window_id: string
  from_seconds: number
  to_seconds: number
  status: SceneCueScanStatus
  error: string | null
}

const SCAN_COLUMNS =
  "id, retention_window_id, from_seconds, to_seconds, status, error"

function mapScanRow(row: SceneCueScanRow): RetentionWindowSceneCueScan {
  return {
    id: row.id,
    retentionWindowId: row.retention_window_id,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    status: row.status,
    error: row.error,
  }
}

// Creates the pending scene-cue-scan row for each of a video's retention
// windows that has an analysis window, one row per window (mirrors the audio
// half of createPendingRetentionWindowMedia). Windows with no analysis window
// (null bounds — see computeAnalysisWindow) are skipped, and any row a
// previous save left behind for them is removed, the same way a shrunk or
// removed analysis window prunes its stale audio row.
export async function createPendingRetentionWindowSceneCueScans(
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
      from_seconds: window.analysisFromSeconds,
      to_seconds: window.analysisToSeconds,
      status: "pending",
      error: null,
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("retention_window_scene_cue_scans")
      .upsert(rows, { onConflict: "retention_window_id" })

    if (error) {
      throw new Error(`Failed to save scene cue scans: ${error.message}`)
    }
  }

  if (windowIdsWithoutAnalysisWindow.length > 0) {
    const { error } = await supabase
      .from("retention_window_scene_cue_scans")
      .delete()
      .eq("user_id", userId)
      .in("retention_window_id", windowIdsWithoutAnalysisWindow)

    if (error) {
      throw new Error(
        `Failed to remove stale scene cue scans: ${error.message}`,
      )
    }
  }
}

// Loads every pending scene-cue scan for a video. No claim/processing state:
// unlike the LLM analysis calls, a rare double-run (two triggers picking up
// the same pending row) just repeats a cheap ffmpeg pass, not a paid one.
export async function getPendingRetentionWindowSceneCueScans(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowSceneCueScan[]> {
  const { data, error } = await supabase
    .from("retention_window_scene_cue_scans")
    .select(SCAN_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "pending")
    .order("retention_window_id", { ascending: true })

  if (error) {
    throw new Error(
      `Failed to load pending scene cue scans: ${error.message}`,
    )
  }

  return ((data ?? []) as SceneCueScanRow[]).map(mapScanRow)
}

export async function updateRetentionWindowSceneCueScanStatus(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  outcome: { status: "ready" } | { status: "failed"; error: string },
): Promise<void> {
  const payload =
    outcome.status === "ready"
      ? { status: "ready", error: null }
      : { status: "failed", error: outcome.error }

  const { error } = await supabase
    .from("retention_window_scene_cue_scans")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to update scene cue scan: ${error.message}`)
  }
}

export type VideoSceneCueKind = "cut" | "freeze" | "black"

export interface VideoSceneCue {
  id: string
  kind: VideoSceneCueKind
  fromSeconds: number
  toSeconds: number
  score: number | null
}

interface VideoSceneCueRow {
  id: string
  kind: VideoSceneCueKind
  from_seconds: number
  to_seconds: number
  score: number | null
}

const CUE_COLUMNS = "id, kind, from_seconds, to_seconds, score"

function mapCueRow(row: VideoSceneCueRow): VideoSceneCue {
  return {
    id: row.id,
    kind: row.kind,
    fromSeconds: row.from_seconds,
    toSeconds: row.to_seconds,
    score: row.score,
  }
}

// Replaces a single window's previously-stored cues with a freshly-scanned
// set. A full replace (not an upsert) because individual cues have no stable
// business key to merge on across re-scans of the same window.
export async function replaceRetentionWindowSceneCues(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  retentionWindowId: string,
  scan: SceneCueScanResult,
): Promise<void> {
  const rows = [
    ...scan.cuts.map((cut) => ({
      retention_window_id: retentionWindowId,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      kind: "cut" as const,
      from_seconds: cut.atSeconds,
      to_seconds: cut.atSeconds,
      score: null,
    })),
    ...scan.freezes.map((span) => ({
      retention_window_id: retentionWindowId,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      kind: "freeze" as const,
      from_seconds: span.fromSeconds,
      to_seconds: span.toSeconds,
      score: null,
    })),
    ...scan.blacks.map((span) => ({
      retention_window_id: retentionWindowId,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      kind: "black" as const,
      from_seconds: span.fromSeconds,
      to_seconds: span.toSeconds,
      score: null,
    })),
  ]

  const { error: deleteError } = await supabase
    .from("video_scene_cues")
    .delete()
    .eq("user_id", userId)
    .eq("retention_window_id", retentionWindowId)

  if (deleteError) {
    throw new Error(
      `Failed to clear previous scene cues: ${deleteError.message}`,
    )
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("video_scene_cues")
      .insert(rows)

    if (insertError) {
      throw new Error(`Failed to save scene cues: ${insertError.message}`)
    }
  }
}

export async function getVideoSceneCues(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<VideoSceneCue[]> {
  const { data, error } = await supabase
    .from("video_scene_cues")
    .select(CUE_COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("from_seconds", { ascending: true })

  if (error) {
    throw new Error(`Failed to load scene cues: ${error.message}`)
  }

  return ((data ?? []) as VideoSceneCueRow[]).map(mapCueRow)
}

export interface SceneCueMetrics {
  cutCount: number
  cutsPerMinute: number | null
  // Fraction (0-1) of the range spent frozen/black — an overlap sum, clamped
  // to the range itself, in case a span starts before or ends after it.
  freezeCoverage: number
  blackCoverage: number
}

function overlapSeconds(
  span: { fromSeconds: number; toSeconds: number },
  fromSeconds: number,
  toSeconds: number,
): number {
  return Math.max(
    0,
    Math.min(span.toSeconds, toSeconds) - Math.max(span.fromSeconds, fromSeconds),
  )
}

// Derives cut-count/cuts-per-minute/freeze-and-black coverage for
// [fromSeconds, toSeconds] from an already-loaded set of cues — computed on
// the go from whichever windows have been scanned, rather than stored as a
// precomputed aggregate.
export function computeSceneCueMetrics(
  cues: VideoSceneCue[],
  fromSeconds: number,
  toSeconds: number,
): SceneCueMetrics {
  const rangeSeconds = toSeconds - fromSeconds
  const durationMinutes = rangeSeconds / 60

  const cutCount = cues.filter(
    (cue) =>
      cue.kind === "cut" &&
      cue.fromSeconds >= fromSeconds &&
      cue.fromSeconds < toSeconds,
  ).length

  const freezeSeconds = cues
    .filter((cue) => cue.kind === "freeze")
    .reduce((sum, cue) => sum + overlapSeconds(cue, fromSeconds, toSeconds), 0)

  const blackSeconds = cues
    .filter((cue) => cue.kind === "black")
    .reduce((sum, cue) => sum + overlapSeconds(cue, fromSeconds, toSeconds), 0)

  return {
    cutCount,
    cutsPerMinute: durationMinutes > 0 ? cutCount / durationMinutes : null,
    freezeCoverage:
      rangeSeconds > 0 ? Math.min(1, freezeSeconds / rangeSeconds) : 0,
    blackCoverage:
      rangeSeconds > 0 ? Math.min(1, blackSeconds / rangeSeconds) : 0,
  }
}

// Approximates a video-wide baseline without a dedicated full-video decode:
// averages each already-scanned window's own metrics. Windows with no cuts
// (cutsPerMinute null only when a range has zero length, which a real
// analysis window never does) are excluded defensively rather than treated
// as zero, so one degenerate range can't skew the average.
export function computeAverageSceneCueMetrics(
  cues: VideoSceneCue[],
  windows: { fromSeconds: number; toSeconds: number }[],
): SceneCueMetrics | null {
  if (windows.length === 0) return null

  const perWindow = windows.map((window) =>
    computeSceneCueMetrics(cues, window.fromSeconds, window.toSeconds),
  )

  const average = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length

  const cutsPerMinuteValues = perWindow
    .map((metrics) => metrics.cutsPerMinute)
    .filter((value): value is number => value != null)

  return {
    cutCount: perWindow.reduce((sum, metrics) => sum + metrics.cutCount, 0),
    cutsPerMinute:
      cutsPerMinuteValues.length > 0 ? average(cutsPerMinuteValues) : null,
    freezeCoverage: average(perWindow.map((metrics) => metrics.freezeCoverage)),
    blackCoverage: average(perWindow.map((metrics) => metrics.blackCoverage)),
  }
}
