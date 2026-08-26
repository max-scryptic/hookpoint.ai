// Read/write helpers for `retention_window_costs` - the per-window record of
// what each deep-analysis LLM call spent. Written by the analysis/synthesis
// orchestrators as each call settles (lib/retention-window-media-analysis.ts,
// lib/retention-window-event-synthesis.ts) and read back, grouped by window,
// for the evidence breakdown (lib/deep-analysis-evidence.ts).

import type { SupabaseClient } from "@supabase/supabase-js"

import type { LlmCallCost } from "@/lib/llm-cost"

// The per-window LLM calls whose cost is tracked, matching the `step` check
// constraint in the retention_window_costs migration.
export type RetentionWindowCostStep =
  | "snapshot"
  | "audio"
  | "event_synthesis"
  | "transcript_taxonomy"

export interface RetentionWindowCost {
  retentionWindowId: string
  step: RetentionWindowCostStep
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

interface RetentionWindowCostRow {
  retention_window_id: string
  step: RetentionWindowCostStep
  model: string
  input_tokens: number
  // Postgres numeric can arrive as a string via PostgREST; coerced on map.
  cost_usd: number | string
  output_tokens: number
}

const COLUMNS =
  "retention_window_id, step, model, input_tokens, output_tokens, cost_usd"

function mapRow(row: RetentionWindowCostRow): RetentionWindowCost {
  return {
    retentionWindowId: row.retention_window_id,
    step: row.step,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.cost_usd),
  }
}

// Records (upserts) the cost of one deep-analysis call against its window and
// step. Upsert on (retention_window_id, step) so re-running a single step
// overwrites just that step's figure rather than accumulating duplicates
// across re-analyses. Callers treat this as best-effort - a costing write must
// never fail the analysis it is only measuring.
export async function recordRetentionWindowCost(
  admin: SupabaseClient,
  params: {
    userId: string
    analysedVideoId: string
    retentionWindowId: string
    step: RetentionWindowCostStep
    cost: LlmCallCost
  },
): Promise<void> {
  const { error } = await admin.from("retention_window_costs").upsert(
    {
      retention_window_id: params.retentionWindowId,
      analysed_video_id: params.analysedVideoId,
      user_id: params.userId,
      step: params.step,
      model: params.cost.model,
      input_tokens: params.cost.inputTokens,
      output_tokens: params.cost.outputTokens,
      cost_usd: params.cost.costUsd,
    },
    { onConflict: "retention_window_id,step" },
  )

  if (error) {
    throw new Error(`Failed to record retention window cost: ${error.message}`)
  }
}

// Loads every recorded per-window cost for a video, ordered by window.
export async function getRetentionWindowCostsForVideo(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<RetentionWindowCost[]> {
  const { data, error } = await supabase
    .from("retention_window_costs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)
    .order("retention_window_id", { ascending: true })
    .order("step", { ascending: true })

  if (error) {
    throw new Error(`Failed to load retention window costs: ${error.message}`)
  }

  return ((data ?? []) as RetentionWindowCostRow[]).map(mapRow)
}
