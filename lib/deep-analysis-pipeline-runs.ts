import type { SupabaseClient } from "@supabase/supabase-js"

import { DEEP_ANALYSIS_PIPELINE_VERSION } from "@/lib/deep-analysis-insight-feedback"

export type DeepAnalysisPipelineStage =
  | "extraction"
  | "media_analysis"
  | "transcript_taxonomy"
  | "event_synthesis"

export interface DeepAnalysisPipelineRun {
  id: string
  stages: Record<string, unknown>
}

export interface DeepAnalysisPipelineRunSummary {
  status: "running" | "ready" | "failed"
  currentStage: string | null
  stages: Record<string, unknown>
  error: string | null
  startedAt: string
  finishedAt: string | null
}

// How long a 'running' lease may go without its updated_at moving before the
// next claim treats it as dead and reclaims it. A pipeline invocation runs
// under a fixed serverless budget (maxDuration = 300s at every trigger point),
// so a lease untouched for meaningfully longer than that budget cannot still
// have a live invocation behind it — its process was killed mid-stage, leaving
// the row 'running' forever with nothing to finish it.
//
// This has to stay comfortably above HEARTBEAT_INTERVAL_MS: a live stage bumps
// updated_at on that heartbeat, so the window only needs to outlast one missed
// beat (plus jitter) to avoid reclaiming a run that's genuinely still working.
// It was 15 minutes before the heartbeat existed — necessary then, because a
// long extraction stage bumped updated_at only at its start and would have been
// mistaken for dead — but that also meant a genuinely dead lease froze every
// resume (and the manual retry) for a full 15 minutes, so a large source file
// that can't finish a stage in one invocation crawled forward one invocation
// per 15 minutes, indistinguishable from permanently stuck. With the heartbeat
// proving liveness, this can sit just above the invocation budget.
const STALE_RUN_MS = 3 * 60 * 1000

// Exported for the resume sweeper (lib/deep-analysis-resume.ts), which has to
// draw the same live/dead line this module does when deciding whether a video's
// pipeline still has an invocation behind it.
export const DEEP_ANALYSIS_RUN_STALE_MS = STALE_RUN_MS

// A running stage bumps its lease this often so the staleness sweep above can
// tell a live long-running stage (a large file's extraction) from a dead
// invocation. See runObservedPipelineStage.
const HEARTBEAT_INTERVAL_MS = 30 * 1000

export async function claimDeepAnalysisPipelineRun(
  admin: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<DeepAnalysisPipelineRun | null> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString()
  await admin
    .from("deep_analysis_pipeline_runs")
    .update({
      status: "failed",
      error: "Pipeline lease expired",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "running")
    .lt("updated_at", staleBefore)

  const { data, error } = await admin
    .from("deep_analysis_pipeline_runs")
    .insert({
      user_id: userId,
      analysed_video_id: analysedVideoId,
      pipeline_version: DEEP_ANALYSIS_PIPELINE_VERSION,
      status: "running",
    })
    .select("id, stages")
    .single()
  // The partial unique index means another trigger already owns this video.
  if (error?.code === "23505") return null
  if (error) throw new Error(`Failed to claim deep analysis pipeline: ${error.message}`)
  return { id: data.id as string, stages: (data.stages ?? {}) as Record<string, unknown> }
}

// Bumps a run's updated_at on a fixed interval for as long as the returned
// stopper hasn't been called. This is what lets STALE_RUN_MS sit just above the
// invocation budget instead of at a defensive 15 minutes: a stage can run for
// the whole budget (a large source file's extraction) without reaching the next
// stage boundary that would otherwise move updated_at, so without a heartbeat a
// live run and a dead one look identical to the staleness sweep. Each beat is
// scoped to status = 'running' so it never resurrects a run that finished or was
// reclaimed in the meantime, and its own failures are swallowed — a missed beat
// just brings the lease one step closer to looking stale, which is safe.
function startLeaseHeartbeat(
  admin: SupabaseClient,
  runId: string,
): () => void {
  const timer = setInterval(() => {
    void admin
      .from("deep_analysis_pipeline_runs")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running")
      .then(
        () => {},
        () => {},
      )
  }, HEARTBEAT_INTERVAL_MS)
  // Never let the heartbeat keep the process alive on its own — the awaited
  // stage is what holds it open; the timer is cleared the moment that settles.
  timer.unref?.()
  return () => clearInterval(timer)
}

// Thrown when a run discovers, at a stage boundary, that it no longer holds the
// lease it started with. Distinct from a stage failure: nothing is wrong with
// this video, the invocation has simply been superseded and must get out of the
// way of whoever owns the pipeline now.
export class DeepAnalysisPipelineSupersededError extends Error {
  constructor(runId: string) {
    super(`Deep analysis pipeline run ${runId} was superseded`)
    this.name = "DeepAnalysisPipelineSupersededError"
  }
}

// Whether this run is still the row the one-running-per-video index points at.
//
// Abandoning a run (a manual retry, or the staleness sweep) only clears the
// *database* lease — it cannot kill the after() callback already executing
// somewhere, which keeps working and writing rows that now belong to whichever
// run took the lease next. Observed in production: a superseded run's synthesis
// stage ran against evidence a concurrent retry had just wiped, released every
// job back to 'pending', and then wrote itself back to 'ready', undoing the
// abandon. Checking ownership at each stage boundary bounds that overlap to the
// stage already in flight instead of letting it run the pipeline to completion.
async function holdsLease(admin: SupabaseClient, runId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("deep_analysis_pipeline_runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle()
  // A read that fails says nothing about ownership — assume the lease is still
  // held rather than aborting a healthy run on a transient DB blip.
  if (error) return true
  return (data as { status?: string } | null)?.status === "running"
}

export async function runObservedPipelineStage(
  admin: SupabaseClient,
  run: DeepAnalysisPipelineRun,
  stage: DeepAnalysisPipelineStage,
  task: () => Promise<void>,
): Promise<void> {
  // Before anything is written for this stage: if the lease is gone, leave the
  // row exactly as the new owner found it.
  if (!(await holdsLease(admin, run.id))) {
    throw new DeepAnalysisPipelineSupersededError(run.id)
  }

  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  await admin.from("deep_analysis_pipeline_runs").update({
    current_stage: stage,
    updated_at: startedAt,
    stages: { ...run.stages, [stage]: { status: "running", startedAt } },
  }).eq("id", run.id)
  const stopHeartbeat = startLeaseHeartbeat(admin, run.id)
  try {
    await task()
    run.stages[stage] = {
      status: "ready",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    }
  } catch (error) {
    run.stages[stage] = {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      error: error instanceof Error ? error.message : "Unknown stage failure",
    }
    await admin.from("deep_analysis_pipeline_runs").update({
      stages: run.stages,
      updated_at: new Date().toISOString(),
    }).eq("id", run.id)
    throw error
  } finally {
    stopHeartbeat()
  }
  await admin.from("deep_analysis_pipeline_runs").update({
    stages: run.stages,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id)
}

// Forcibly marks any in-flight ('running') run for a video as failed, so the
// partial unique index that pins one running run per video is cleared and the
// next claim can start fresh. The heartbeat + STALE_RUN_MS sweep already
// reclaims a dead lease on its own, but only after the stale window elapses;
// the manual "retry deep analysis" flow can't wait that out — a user hitting
// retry expects the pipeline to restart now, not up to STALE_RUN_MS later — so
// it abandons the current run explicitly before re-triggering. Uses the service
// role (there's no authenticated write policy on this table); callers must pass
// an admin client.
export async function abandonInFlightDeepAnalysisPipelineRun(
  admin: SupabaseClient,
  analysedVideoId: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await admin
    .from("deep_analysis_pipeline_runs")
    .update({
      status: "failed",
      error: "Superseded by a manual retry",
      finished_at: now,
      updated_at: now,
    })
    .eq("analysed_video_id", analysedVideoId)
    .eq("status", "running")
  if (error) {
    throw new Error(
      `Failed to abandon in-flight deep analysis pipeline: ${error.message}`,
    )
  }
}

export async function finishDeepAnalysisPipelineRun(
  admin: SupabaseClient,
  run: DeepAnalysisPipelineRun,
  outcome: { status: "ready" } | { status: "failed"; error: string },
): Promise<void> {
  const now = new Date().toISOString()
  // Scoped to status = 'running' so a run that was abandoned mid-flight can't
  // resurrect itself. Without this guard a superseded invocation reaching its
  // final write flips the row back to a terminal 'ready' — which is exactly how
  // a video ended up looking finished while its actual work sat pending, and
  // how an abandoned run silently erased the record of having been abandoned.
  const { data, error } = await admin
    .from("deep_analysis_pipeline_runs")
    .update({
      status: outcome.status,
      current_stage: null,
      stages: run.stages,
      error: outcome.status === "failed" ? outcome.error : null,
      finished_at: now,
      updated_at: now,
    })
    .eq("id", run.id)
    .eq("status", "running")
    .select("id")
  if (error) throw new Error(`Failed to finish deep analysis pipeline: ${error.message}`)
  if ((data?.length ?? 0) === 0) {
    console.warn(
      `Deep analysis pipeline run ${run.id} was superseded before it could be finished`,
    )
  }
}

export async function getLatestDeepAnalysisPipelineRun(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<DeepAnalysisPipelineRunSummary | null> {
  const { data, error } = await supabase
    .from("deep_analysis_pipeline_runs")
    .select("status, current_stage, stages, error, started_at, finished_at")
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load deep analysis pipeline run: ${error.message}`)
  if (!data) return null
  return {
    status: data.status as DeepAnalysisPipelineRunSummary["status"],
    currentStage: data.current_stage as string | null,
    stages: (data.stages ?? {}) as Record<string, unknown>,
    error: data.error as string | null,
    startedAt: data.started_at as string,
    finishedAt: data.finished_at as string | null,
  }
}
