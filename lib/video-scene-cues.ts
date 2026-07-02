// Read/write helpers for `video_scene_cues` and the scene-cue-scan status
// columns on `analysed_videos` — the deterministic (non-LLM) cut/freeze/black
// timestamps a single full-video ffmpeg pass produces
// (lib/media/scene-detection.ts).
//
// Stored as one row per detected event rather than per-window aggregates, so
// cut-count/cuts-per-minute/freeze-and-black-coverage for *any* [from, to]
// range — a retention window's padded analysis range, the raw detected
// window, or the whole video as a baseline to compare a window against — are
// computed on read from the same cue set, without re-running ffmpeg per
// window or every time a window's bounds get redefined.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"

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

export type SceneCueScanStatus = "pending" | "processing" | "ready" | "failed"

// A claim held longer than this is treated as abandoned (the caller almost
// certainly hit a function timeout mid-scan) and can be reclaimed by the next
// trigger — the same tolerance retention window media analysis gives a stuck
// 'processing' claim.
const SCAN_CLAIM_STALE_MS = 10 * 60 * 1000

// Atomically claims a video's scene-cue scan by flipping
// scene_cue_scan_status pending -> processing (or reclaiming an abandoned
// processing claim), so two triggers racing for the same video (this can be
// kicked off from more than one place — see
// lib/retention-window-media-trigger.ts) can't both pay for a full-video
// ffmpeg decode. Returns true only for the caller that actually won the
// claim.
export async function claimVideoForSceneCueScan(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SCAN_CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("analysed_videos")
    .update({ scene_cue_scan_status: "processing" })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .or(
      `scene_cue_scan_status.eq.pending,and(scene_cue_scan_status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select("id")

  if (error) {
    throw new Error(
      `Failed to claim video for scene cue scan: ${error.message}`,
    )
  }

  return (data ?? []).length > 0
}

export async function markSceneCueScanReady(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({
      scene_cue_scan_status: "ready",
      scene_cue_scan_error: null,
      scene_cue_scanned_at: new Date().toISOString(),
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to mark scene cue scan ready: ${error.message}`)
  }
}

export async function markSceneCueScanFailed(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({
      scene_cue_scan_status: "failed",
      scene_cue_scan_error: errorMessage,
    })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to mark scene cue scan failed: ${error.message}`)
  }
}

// Replaces every previously-stored cue for a video with a freshly-scanned
// set. A full replace (not an upsert) because individual cues have no stable
// business key to merge on across re-scans — the whole point of storing raw
// timestamps is that a re-scan just supersedes the old set outright.
export async function replaceVideoSceneCues(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  scan: SceneCueScanResult,
): Promise<void> {
  const rows = [
    ...scan.cuts.map((cut) => ({
      analysed_video_id: analysedVideoId,
      user_id: userId,
      kind: "cut" as const,
      from_seconds: cut.atSeconds,
      to_seconds: cut.atSeconds,
      score: null,
    })),
    ...scan.freezes.map((span) => ({
      analysed_video_id: analysedVideoId,
      user_id: userId,
      kind: "freeze" as const,
      from_seconds: span.fromSeconds,
      to_seconds: span.toSeconds,
      score: null,
    })),
    ...scan.blacks.map((span) => ({
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
    .eq("analysed_video_id", analysedVideoId)

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
// the go rather than stored per window, so the same cue set answers this for
// a retention window's analysis range, the raw detected window, or the whole
// video (pass [0, durationSeconds] for a baseline to compare a window's rate
// against).
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
