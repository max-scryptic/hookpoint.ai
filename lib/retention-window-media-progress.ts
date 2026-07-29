// Aggregates a video's "deep analysis" pipeline — transcoding the raw upload,
// scanning each window for scene cues, harvesting the resulting
// snapshots/audio, running AI analysis over the harvested media
// (lib/retention-window-media-analysis.ts), then synthesizing cross-modal
// events from that analysis (lib/retention-window-event-synthesis.ts) — into
// a small set of stage statuses the source-file card can poll and render as
// a checklist. Transcript clipping isn't included here: it runs
// synchronously off the YouTube captions API while retention windows are
// saved (see lib/retention-window-transcripts.ts), so by the time a source
// file even exists to poll about, it has already settled — there's nothing
// left to report progress on.

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
  transcriptTaxonomy: DeepAnalysisStageStatus
  eventSynthesis: DeepAnalysisStageStatus
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
    if (row.status === "pending" || row.status === "processing") pending++
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

// Only window transcript rows that are part of deep analysis carry a
// taxonomy_status (the rest are null — see saveRetentionWindowTranscripts), so a
// null row is excluded from the total entirely rather than counted as pending.
// 'skipped' (an empty transcript that settled with nothing to read) and 'ready'
// are both done; 'pending'/'processing' are unsettled; 'failed' is a real
// outcome. total===0 means no window was selected for a taxonomy — settled.
function countByTaxonomyStatus(
  rows: { taxonomy_status: string | null }[],
): { total: number; pending: number; failed: number } {
  let total = 0
  let pending = 0
  let failed = 0
  for (const row of rows) {
    if (row.taxonomy_status == null) continue
    total++
    if (row.taxonomy_status === "pending" || row.taxonomy_status === "processing") {
      pending++
    } else if (row.taxonomy_status === "failed") {
      failed++
    }
  }
  return { total, pending, failed }
}

function isStageSettled(status: DeepAnalysisStageStatus): boolean {
  return status === "ready" || status === "failed"
}

// Whether the deep-analysis pipeline should be re-kicked from the browser's
// progress-poll heartbeat.
//
// The pipeline's original kickoff is a single best-effort after() callback
// (see lib/retention-window-media-trigger.ts). A large source file can exhaust
// that invocation partway through — stalling at extraction (snapshots/audio),
// media analysis, or the final event synthesis — and leave the remaining rows
// 'pending' with nothing left to pick them up, so the checklist sits on a
// spinner (e.g. "Fetching snapshots") indefinitely. The browser polls
// analysis-progress on a heartbeat while any stage is still unsettled, so that
// heartbeat is used to resume a stalled pipeline: re-trigger it whenever it's
// active but not yet complete, not only when the cheap final synthesis stage
// is the one left hanging.
//
// Re-triggering is idempotent and safe to fire on every poll: the pipeline-run
// lease (claimDeepAnalysisPipelineRun) makes an overlapping kick a no-op while
// a run is genuinely still in flight, its 15-minute staleness sweep reclaims a
// run whose invocation died, and every stage only ever claims rows that are
// still pending — so a repeated kick resumes a stalled run's leftover work
// without redoing anything that already settled.
export function shouldResumeDeepAnalysis(progress: DeepAnalysisProgress): boolean {
  return progress.active && progress.stages != null && !progress.complete
}

// Given a user's ready source files, returns the set of analysed-video ids whose
// deep-analysis pipeline is still in flight — i.e. the raw file has landed but
// the deeper analysis hasn't finished. This is the cheap, list-friendly answer
// to "is this video still processing?" without computing the full per-stage
// breakdown (getDeepAnalysisProgress) for every video, which would be one fan-out
// of queries per video.
//
// It leans on two facts about the pipeline: transcoding (normalisation) is its
// first stage, and event synthesis is its terminal one — and synthesis jobs are
// created eagerly at analyse time (see createPendingRetentionWindowEventSynthesis),
// so a settled set of synthesis rows means every upstream stage that fed them has
// settled too. A video is therefore still processing when its transcoding hasn't
// settled, or any of its synthesis rows is still pending/processing. A video with
// no synthesis rows and settled transcoding had nothing to deep-analyse, so it
// isn't counted.
export async function listProcessingAnalysedVideoIds(
  supabase: SupabaseClient,
  userId: string,
  readyFiles: {
    analysedVideoId: string
    normalisationStatus: NormalisationStatus
  }[],
): Promise<Set<string>> {
  const processing = new Set<string>()
  if (readyFiles.length === 0) return processing

  const analysedVideoIds = readyFiles.map((file) => file.analysedVideoId)

  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id, status")
    .eq("user_id", userId)
    .in("analysed_video_id", analysedVideoIds)

  if (error) {
    throw new Error(
      `Failed to load event synthesis statuses for processing check: ${error.message}`,
    )
  }

  const synthesisPending = new Set<string>()
  for (const row of (data ?? []) as {
    analysed_video_id: string
    status: string
  }[]) {
    if (row.status === "pending" || row.status === "processing") {
      synthesisPending.add(row.analysed_video_id)
    }
  }

  for (const file of readyFiles) {
    const transcodingUnsettled =
      file.normalisationStatus === "pending" ||
      file.normalisationStatus === "processing"
    if (transcodingUnsettled || synthesisPending.has(file.analysedVideoId)) {
      processing.add(file.analysedVideoId)
    }
  }

  return processing
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
  const [
    snapshotsResult,
    audioResult,
    sceneCueScansResult,
    eventSynthesisResult,
    transcriptTaxonomyResult,
  ] = await Promise.all([
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
    supabase
      .from("retention_window_transcripts")
      .select("taxonomy_status")
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
  if (transcriptTaxonomyResult.error) {
    throw new Error(
      `Failed to load transcript taxonomy statuses: ${transcriptTaxonomyResult.error.message}`,
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
  const transcriptTaxonomyRows = (transcriptTaxonomyResult.data ?? []) as {
    taxonomy_status: string | null
  }[]

  const snapshotCounts = countByStatus(snapshotRows)
  const audioCounts = countByStatus(audioRows)
  const snapshotAnalysisCounts = countByAnalysisStatus(snapshotRows)
  const audioAnalysisCounts = countByAnalysisStatus(audioRows)
  const sceneCueScanCounts = countSceneCueScansByStatus(sceneCueScanRows)
  const eventSynthesisCounts = countByStatus(eventSynthesisRows)
  const transcriptTaxonomyCounts = countByTaxonomyStatus(transcriptTaxonomyRows)

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
  const snapshots: DeepAnalysisStageStatus = isStageSettled(sceneCueScan)
    ? deriveMediaStageStatus(
        snapshotCounts.total,
        snapshotCounts.pending,
        snapshotCounts.failed,
      )
    : "in_progress"

  const stages: DeepAnalysisStages = {
    transcoding: normalisationToStageStatus(sourceFile.normalisationStatus),
    sceneCueScan,
    snapshots,
    // Same "no rows yet" ambiguity as snapshots above: snapshot rows (and
    // thus their analysis_status) don't exist until the scan has produced
    // them, so a zero count here only means "already done" once snapshots
    // itself has settled — otherwise report in-progress instead of flashing
    // ready before the scan/harvest has even started.
    snapshotAnalysis: isStageSettled(snapshots)
      ? deriveMediaStageStatus(
          snapshotAnalysisCounts.total,
          snapshotAnalysisCounts.pending,
          snapshotAnalysisCounts.failed,
        )
      : "in_progress",
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
    // Transcript rows exist immediately (no extraction to wait on), and only
    // the deep-analysis-selected ones carry a taxonomy_status, so a zero total
    // here genuinely means "no window selected for a taxonomy" and needs no
    // extra gating — the same as event synthesis below.
    transcriptTaxonomy: deriveMediaStageStatus(
      transcriptTaxonomyCounts.total,
      transcriptTaxonomyCounts.pending,
      transcriptTaxonomyCounts.failed,
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
  }

  return {
    active: true,
    complete: Object.values(stages).every(isStageSettled),
    stages,
  }
}
