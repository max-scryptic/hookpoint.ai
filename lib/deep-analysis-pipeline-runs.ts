import type { SupabaseClient } from "@supabase/supabase-js"

import { DEEP_ANALYSIS_PIPELINE_VERSION } from "@/lib/deep-analysis-insight-feedback"

export type DeepAnalysisPipelineStage = "extraction" | "media_analysis" | "event_synthesis"

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

const STALE_RUN_MS = 15 * 60 * 1000

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

export async function runObservedPipelineStage(
  admin: SupabaseClient,
  run: DeepAnalysisPipelineRun,
  stage: DeepAnalysisPipelineStage,
  task: () => Promise<void>,
): Promise<void> {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  await admin.from("deep_analysis_pipeline_runs").update({
    current_stage: stage,
    updated_at: startedAt,
    stages: { ...run.stages, [stage]: { status: "running", startedAt } },
  }).eq("id", run.id)
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
  }
  await admin.from("deep_analysis_pipeline_runs").update({
    stages: run.stages,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id)
}

export async function finishDeepAnalysisPipelineRun(
  admin: SupabaseClient,
  run: DeepAnalysisPipelineRun,
  outcome: { status: "ready" } | { status: "failed"; error: string },
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await admin.from("deep_analysis_pipeline_runs").update({
    status: outcome.status,
    current_stage: null,
    stages: run.stages,
    error: outcome.status === "failed" ? outcome.error : null,
    finished_at: now,
    updated_at: now,
  }).eq("id", run.id)
  if (error) throw new Error(`Failed to finish deep analysis pipeline: ${error.message}`)
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
