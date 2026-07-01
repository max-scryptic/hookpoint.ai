// Aggregates a video's "deep analysis" pipeline — transcoding the raw upload,
// then harvesting per-window snapshots/audio from it — into a small set of
// stage statuses the source-file card can poll and render as a checklist.
// Transcript clipping isn't included as real progress: it runs synchronously
// off the YouTube captions API while retention windows are saved (see
// lib/retention-window-transcripts.ts), so by the time a source file even
// exists to poll about, it has already settled.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { NormalisationStatus, SourceFile } from "@/lib/source-files/source-files"

export type DeepAnalysisStageStatus = "pending" | "in_progress" | "ready" | "failed"

export interface DeepAnalysisStages {
  transcoding: DeepAnalysisStageStatus
  snapshots: DeepAnalysisStageStatus
  audio: DeepAnalysisStageStatus
  transcript: DeepAnalysisStageStatus
}

export interface DeepAnalysisProgress {
  // False when there's nothing to poll about yet (no source file, or it
  // hasn't finished uploading/validating). `stages` is null in that case.
  active: boolean
  // True once every stage has settled (ready or failed) — the caller can stop
  // polling.
  complete: boolean
  stages: DeepAnalysisStages | null
}

function normalisationToStageStatus(
  status: NormalisationStatus,
): DeepAnalysisStageStatus {
  switch (status) {
    case "pending":
      return "pending"
    case "processing":
      return "in_progress"
    case "ready":
    case "skipped":
      return "ready"
    case "failed":
      return "failed"
  }
}

// total===0 means there was nothing to harvest for this video (e.g. no window
// ended up with an analysis range) — treat that as settled rather than stuck
// waiting on rows that will never appear. A row-level failure only fails the
// whole stage if *every* row failed; a handful of bad seeks shouldn't block
// the rest of the report on an otherwise-successful harvest.
function deriveMediaStageStatus(
  total: number,
  pending: number,
  failed: number,
): DeepAnalysisStageStatus {
  if (total === 0) return "ready"
  if (pending > 0) return "in_progress"
  if (failed === total) return "failed"
  return "ready"
}

function countByStatus(
  rows: { status: string }[],
): { total: number; pending: number; failed: number } {
  let pending = 0
  let failed = 0
  for (const row of rows) {
    if (row.status === "pending") pending++
    else if (row.status === "failed") failed++
  }
  return { total: rows.length, pending, failed }
}

function isStageSettled(status: DeepAnalysisStageStatus): boolean {
  return status === "ready" || status === "failed"
}

// Loads the current stage statuses for a video whose source file has finished
// uploading. Callers must have already confirmed `sourceFile.uploadStatus ===
// "ready"` — this only reports on what happens after that point.
export async function getDeepAnalysisProgress(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  sourceFile: SourceFile,
): Promise<DeepAnalysisProgress> {
  const [snapshotsResult, audioResult] = await Promise.all([
    supabase
      .from("retention_window_snapshots")
      .select("status")
      .eq("user_id", userId)
      .eq("analysed_video_id", analysedVideoId),
    supabase
      .from("retention_window_audio")
      .select("status")
      .eq("user_id", userId)
      .eq("analysed_video_id", analysedVideoId),
  ])

  if (snapshotsResult.error) {
    throw new Error(
      `Failed to load retention window snapshot statuses: ${snapshotsResult.error.message}`,
    )
  }
  if (audioResult.error) {
    throw new Error(
      `Failed to load retention window audio statuses: ${audioResult.error.message}`,
    )
  }

  const snapshotCounts = countByStatus(
    (snapshotsResult.data ?? []) as { status: string }[],
  )
  const audioCounts = countByStatus((audioResult.data ?? []) as { status: string }[])

  const stages: DeepAnalysisStages = {
    transcoding: normalisationToStageStatus(sourceFile.normalisationStatus),
    snapshots: deriveMediaStageStatus(
      snapshotCounts.total,
      snapshotCounts.pending,
      snapshotCounts.failed,
    ),
    audio: deriveMediaStageStatus(
      audioCounts.total,
      audioCounts.pending,
      audioCounts.failed,
    ),
    transcript: "ready",
  }

  return {
    active: true,
    complete: Object.values(stages).every(isStageSettled),
    stages,
  }
}
