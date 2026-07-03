// Aggregates a video's "deep analysis" pipeline — transcoding the raw upload,
// scanning each window for scene cues, harvesting the resulting
// snapshots/audio, running AI analysis over the harvested media
// (lib/retention-window-media-analysis.ts), then synthesizing cross-modal
// events from that analysis (lib/retention-window-event-synthesis.ts) — into
// a small set of stage statuses the source-file card can poll and render as
// a checklist. Transcript clipping isn't included as real progress: it runs
// synchronously off the YouTube captions API while retention windows are
// saved (see lib/retention-window-transcripts.ts), so by the time a source
// file even exists to poll about, it has already settled.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { NormalisationStatus, SourceFile } from "@/lib/source-files/source-files"
import { SCAN_RETRY_STALE_MS } from "@/lib/video-scene-cues"

export type DeepAnalysisStageStatus = "pending" | "in_progress" | "ready" | "failed"

export interface DeepAnalysisStages {
  transcoding: DeepAnalysisStageStatus
  sceneCueScan: DeepAnalysisStageStatus
  snapshots: DeepAnalysisStageStatus
  snapshotAnalysis: DeepAnalysisStageStatus
  audio: DeepAnalysisStageStatus
  audioAnalysis: DeepAnalysisStageStatus
  eventSynthesis: DeepAnalysisStageStatus
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

// Scene-cue scans are the one stage with its own automatic retry (see
// SCAN_RETRY_STALE_MS in lib/video-scene-cues.ts): a failed scan isn't
// abandoned until it's been failed for that long, so a scan that failed a
// moment ago (a single transient ffmpeg timeout/seek error) is still
// something the system intends to retry, not a settled outcome yet. Counting
// it as failed here would flash a red X in the checklist for a scan that
// hasn't actually had its retry attempt yet; count it as pending instead,
// same as one still waiting on its first attempt, until that grace period
// actually elapses with no successful retry.
function countSceneCueScansByStatus(
  rows: { status: string; updated_at: string }[],
): { total: number; pending: number; failed: number } {
  const retryDeadline = Date.now() - SCAN_RETRY_STALE_MS
  let pending = 0
  let failed = 0
  for (const row of rows) {
    if (row.status === "pending") {
      pending++
    } else if (row.status === "failed") {
      if (new Date(row.updated_at).getTime() > retryDeadline) pending++
      else failed++
    }
  }
  return { total: rows.length, pending, failed }
}

// Analysis only ever runs on a row once extraction has succeeded
// (status = 'ready') — see claimRetentionWindowSnapshotsPendingAnalysis/
// claimRetentionWindowAudioPendingAnalysis. So a row whose extraction is still
// pending counts as analysis-pending too (nothing to analyse yet), and a row
// whose extraction failed counts as analysis-failed (it never will have
// anything to analyse), rather than leaving either stuck 'pending' forever.
// 'processing' (a claim held while an LLM call is in flight) counts the same
// as 'pending' here — it's still unsettled, not a real outcome.
function countByAnalysisStatus(
  rows: { status: string; analysis_status: string }[],
): { total: number; pending: number; failed: number } {
  let pending = 0
  let failed = 0
  for (const row of rows) {
    if (row.status === "failed") failed++
    else if (
      row.status !== "ready" ||
      row.analysis_status === "pending" ||
      row.analysis_status === "processing"
    ) {
      pending++
    } else if (row.analysis_status === "failed") failed++
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
  const [snapshotsResult, audioResult, sceneCueScansResult, eventSynthesisResult] =
    await Promise.all([
      supabase
        .from("retention_window_snapshots")
        .select("status, analysis_status")
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId),
      supabase
        .from("retention_window_audio")
        .select("status, analysis_status")
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId),
      supabase
        .from("retention_window_scene_cue_scans")
        .select("status, updated_at")
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId),
      supabase
        .from("retention_window_event_synthesis")
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
  if (sceneCueScansResult.error) {
    throw new Error(
      `Failed to load scene cue scan statuses: ${sceneCueScansResult.error.message}`,
    )
  }
  if (eventSynthesisResult.error) {
    throw new Error(
      `Failed to load event synthesis statuses: ${eventSynthesisResult.error.message}`,
    )
  }

  const snapshotRows = (snapshotsResult.data ?? []) as {
    status: string
    analysis_status: string
  }[]
  const audioRows = (audioResult.data ?? []) as {
    status: string
    analysis_status: string
  }[]
  const sceneCueScanRows = (sceneCueScansResult.data ?? []) as {
    status: string
    updated_at: string
  }[]
  const eventSynthesisRows = (eventSynthesisResult.data ?? []) as {
    status: string
  }[]

  const snapshotCounts = countByStatus(snapshotRows)
  const audioCounts = countByStatus(audioRows)
  const snapshotAnalysisCounts = countByAnalysisStatus(snapshotRows)
  const audioAnalysisCounts = countByAnalysisStatus(audioRows)
  const sceneCueScanCounts = countSceneCueScansByStatus(sceneCueScanRows)
  const eventSynthesisCounts = countByStatus(eventSynthesisRows)

  const sceneCueScan = deriveMediaStageStatus(
    sceneCueScanCounts.total,
    sceneCueScanCounts.pending,
    sceneCueScanCounts.failed,
  )

  // Snapshot rows don't exist until a window's scene-cue scan has actually
  // produced them (their timestamps are derived from its detected cuts — see
  // createRetentionWindowSnapshotsFromSceneCues) — so a snapshot count of
  // zero only means "nothing to harvest" once every scan has settled. While
  // scans are still in flight, report snapshots as in-progress instead of
  // misreading "no rows yet" as "already done".
  const stages: DeepAnalysisStages = {
    transcoding: normalisationToStageStatus(sourceFile.normalisationStatus),
    sceneCueScan,
    snapshots: isStageSettled(sceneCueScan)
      ? deriveMediaStageStatus(
          snapshotCounts.total,
          snapshotCounts.pending,
          snapshotCounts.failed,
        )
      : "in_progress",
    snapshotAnalysis: deriveMediaStageStatus(
      snapshotAnalysisCounts.total,
      snapshotAnalysisCounts.pending,
      snapshotAnalysisCounts.failed,
    ),
    audio: deriveMediaStageStatus(
      audioCounts.total,
      audioCounts.pending,
      audioCounts.failed,
    ),
    audioAnalysis: deriveMediaStageStatus(
      audioAnalysisCounts.total,
      audioAnalysisCounts.pending,
      audioAnalysisCounts.failed,
    ),
    // Unlike snapshots, event-synthesis jobs are created eagerly (at analyze
    // time, alongside audio/scene-cue-scan jobs) rather than derived from a
    // prior step — so a zero count here needs no extra gating, it really
    // does mean "nothing to synthesize" (e.g. no window had an analysis
    // window at all).
    eventSynthesis: deriveMediaStageStatus(
      eventSynthesisCounts.total,
      eventSynthesisCounts.pending,
      eventSynthesisCounts.failed,
    ),
    transcript: "ready",
  }

  return {
    active: true,
    complete: Object.values(stages).every(isStageSettled),
    stages,
  }
}
