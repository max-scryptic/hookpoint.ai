// Finds videos whose deep-analysis pipeline has unfinished work and no live
// invocation behind it, so something can kick them again.
//
// The pipeline's only means of making progress is an after() callback attached
// to some request (see lib/retention-window-media-trigger.ts). That callback
// runs under a fixed serverless budget, and a video large enough to exhaust it
// mid-stage leaves its rows 'pending' with its lease stuck 'running' — the
// staleness sweep that would reclaim that lease lives inside
// claimDeepAnalysisPipelineRun, which only executes when something triggers the
// pipeline in the first place. Nothing did. Until this module, the only
// automatic trigger was the browser polling a video's own analysis-progress
// endpoint, so a stalled pipeline resumed only if the user happened to reopen
// that exact page: a video observed sitting on "Processing…" for three hours
// finished within seconds of the page being loaded again.
//
// The candidates here are deliberately the same ones the UI paints as
// "Processing…" (see listProcessingAnalysedVideoIds): a video with any
// pending/processing event-synthesis row. Synthesis is the pipeline's terminal
// stage and its jobs are created eagerly at analyse time, so an unsettled
// synthesis row means some upstream stage never finished. Keeping the two
// definitions aligned is the point — anything the user is being shown as still
// processing is something this sweep will act on.
//
// Not covered: a source file stuck in transcoding. That waits on the
// transcoder's callback rather than on an invocation of ours, so re-kicking the
// pipeline would achieve nothing; a stalled transcode is a separate problem
// needing a separate reconciliation against the provider.

import type { SupabaseClient } from "@supabase/supabase-js"

import { DEEP_ANALYSIS_RUN_STALE_MS } from "@/lib/deep-analysis-pipeline-runs"
import {
  listReadySourceFilesByAnalysedVideoIds,
  type SourceFile,
} from "@/lib/source-files/source-files"

// A video is left alone while its newest run is younger than this. A run that
// has only just started may simply not have reached its first heartbeat, and a
// run that just ended may have handed off work that hasn't landed yet — either
// way, re-kicking that fast only burns invocations racing a healthy pipeline.
// Matching the lease staleness window keeps one definition of "long enough
// without progress to be considered dead".
const RESUME_COOLDOWN_MS = DEEP_ANALYSIS_RUN_STALE_MS

// After this many runs against one video, stop resuming it automatically.
// Resumption is only ever worth it for a pipeline that can still make progress;
// a video whose jobs settle back to 'pending' every attempt (evidence that will
// never arrive, a persistently failing dependency) would otherwise be retried
// every sweep, forever, at real OpenAI and compute cost. Hitting this cap means
// the video needs a human, not another identical attempt — the user's explicit
// retry button is unaffected and still resets and re-runs from scratch.
const MAX_RUNS_PER_VIDEO = 12

// Upper bound on unsettled synthesis rows pulled in one sweep. Each video
// contributes one row per retention window, so this covers far more videos than
// a single sweep would ever act on while keeping the query bounded.
const UNSETTLED_ROW_SCAN_LIMIT = 1000

export interface ResumableDeepAnalysisOptions {
  // Narrows the sweep to one account. Omitted by the cron (which sweeps every
  // user through the admin client), set by the dashboard poll, which runs on
  // the caller's RLS-scoped client and only ever resumes their own videos.
  userId?: string
  // Most videos to return. Callers resume these sequentially inside one
  // invocation's budget, so this is what stops a backlog from being attempted
  // all at once; whatever doesn't fit is picked up by the next sweep.
  limit: number
}

interface RunAggregate {
  runCount: number
  hasLiveLease: boolean
  newestStartedAtMs: number
}

// Videos with deep-analysis work outstanding that nothing is currently working
// on, as the full SourceFile each one's pipeline needs to be re-triggered with.
export async function listResumableDeepAnalysisSourceFiles(
  supabase: SupabaseClient,
  { userId, limit }: ResumableDeepAnalysisOptions,
): Promise<SourceFile[]> {
  if (limit <= 0) return []

  let unsettledQuery = supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id")
    .in("status", ["pending", "processing"])
    .limit(UNSETTLED_ROW_SCAN_LIMIT)
  if (userId) unsettledQuery = unsettledQuery.eq("user_id", userId)

  const { data: unsettled, error: unsettledError } = await unsettledQuery
  if (unsettledError) {
    throw new Error(
      `Failed to load unsettled event synthesis jobs: ${unsettledError.message}`,
    )
  }

  const candidateIds = [
    ...new Set(
      ((unsettled ?? []) as { analysed_video_id: string }[]).map(
        (row) => row.analysed_video_id,
      ),
    ),
  ]
  if (candidateIds.length === 0) return []

  const { data: runs, error: runsError } = await supabase
    .from("deep_analysis_pipeline_runs")
    .select("analysed_video_id, status, started_at, updated_at")
    .in("analysed_video_id", candidateIds)
  if (runsError) {
    throw new Error(
      `Failed to load deep analysis pipeline runs for resume sweep: ${runsError.message}`,
    )
  }

  const now = Date.now()
  const liveLeaseAfterMs = now - DEEP_ANALYSIS_RUN_STALE_MS
  const cooldownAfterMs = now - RESUME_COOLDOWN_MS

  const byVideo = new Map<string, RunAggregate>()
  for (const row of (runs ?? []) as {
    analysed_video_id: string
    status: string
    started_at: string
    updated_at: string
  }[]) {
    const aggregate = byVideo.get(row.analysed_video_id) ?? {
      runCount: 0,
      hasLiveLease: false,
      newestStartedAtMs: 0,
    }
    aggregate.runCount += 1
    // A 'running' row whose heartbeat is still fresh has a real invocation
    // behind it. One that went quiet does not, however 'running' it claims to
    // be — that is precisely the state this sweep exists to rescue.
    if (
      row.status === "running" &&
      new Date(row.updated_at).getTime() > liveLeaseAfterMs
    ) {
      aggregate.hasLiveLease = true
    }
    aggregate.newestStartedAtMs = Math.max(
      aggregate.newestStartedAtMs,
      new Date(row.started_at).getTime(),
    )
    byVideo.set(row.analysed_video_id, aggregate)
  }

  const resumableIds = candidateIds.filter((id) => {
    const aggregate = byVideo.get(id)
    // No run at all, yet synthesis jobs exist: the original kickoff never got
    // as far as claiming a lease. Nothing to wait for — resume it.
    if (!aggregate) return true
    if (aggregate.hasLiveLease) return false
    if (aggregate.runCount >= MAX_RUNS_PER_VIDEO) return false
    return aggregate.newestStartedAtMs < cooldownAfterMs
  })
  if (resumableIds.length === 0) return []

  const sourceFiles = await listReadySourceFilesByAnalysedVideoIds(
    supabase,
    resumableIds,
  )
  return sourceFiles.slice(0, limit)
}
