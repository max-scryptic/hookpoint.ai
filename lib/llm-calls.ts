// Write-side helper for `cost_logs` — the account-wide, append-only log of
// every paid AI/media cost we incur (see the 20260720130000_create_cost_logs
// migration). Every OpenAI call site and the Qencode transcoding callback logs
// here as its cost settles, so the admin cost log can show exactly which calls
// we run and their spend.
//
// Logging is always best-effort: a failure to record a cost must never fail the
// call it is only measuring. Every write is wrapped so it logs and returns
// rather than throwing.
//
// The table is admin-only (RLS enabled, no policies), so writes go through the
// service-role client. Call sites that already hold one (the deep-analysis
// pipeline) pass it in to reuse; the rest let this create one.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import type { LlmCallCost } from "@/lib/llm-cost"
import {
  type CostType,
  type LlmCallProvider,
  type LlmCallType,
  type LlmLogContext,
} from "@/lib/llm-call-types"

// The pure constants and types live in lib/llm-call-types.ts (importable from
// client components); re-exported here so existing server-side call sites that
// import them from "@/lib/llm-calls" keep working.
export {
  COST_TYPES,
  COST_TYPE_LABELS,
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  type CostType,
  type LlmCallType,
  type LlmCallProvider,
  type LlmLogContext,
} from "@/lib/llm-call-types"

export interface RecordCostLogParams {
  userId?: string | null
  // Denormalised so a historical cost still names its user after the account is
  // deleted. Usually left unset (the admin listing resolves it via users).
  userEmail?: string | null
  analysedVideoId?: string | null
  // The broad category — an LLM call vs a Qencode transcode.
  costType: CostType
  // The specific LLM call kind; null/absent for costs with no such breakdown
  // (e.g. a Qencode transcode).
  callType?: LlmCallType | null
  provider?: LlmCallProvider
  // Null for transcoding, which has no model.
  model?: string | null
  inputTokens?: number
  outputTokens?: number
  costUsd: number
  // Defaults to now() in the database when omitted.
  createdAt?: string
}

// Records one cost. Best-effort: never throws — a logging failure is swallowed
// (and logged) so it can't break the pipeline it is measuring. Pass `admin` to
// reuse a service-role client the caller already holds; otherwise one is made.
export async function recordCostLog(
  params: RecordCostLogParams,
  admin?: SupabaseClient,
): Promise<void> {
  try {
    const client = admin ?? createAdminClient()
    const { error } = await client.from("cost_logs").insert({
      user_id: params.userId ?? null,
      user_email: params.userEmail ?? null,
      analysed_video_id: params.analysedVideoId ?? null,
      cost_type: params.costType,
      call_type: params.callType ?? null,
      provider: params.provider ?? "openai",
      model: params.model ?? null,
      input_tokens: Math.max(0, Math.round(params.inputTokens ?? 0)),
      output_tokens: Math.max(0, Math.round(params.outputTokens ?? 0)),
      cost_usd: params.costUsd,
      ...(params.createdAt ? { created_at: params.createdAt } : {}),
    })
    if (error) {
      console.error("Failed to record cost log", error.message)
    }
  } catch (error) {
    console.error("Failed to record cost log", error)
  }
}

// Convenience for the common case: an OpenAI call whose cost was computed by
// lib/llm-cost.ts. Records it as an 'llm_call' cost with the given call type.
export async function recordLlmCallCost(
  callType: LlmCallType,
  cost: LlmCallCost,
  context: LlmLogContext,
  admin?: SupabaseClient,
): Promise<void> {
  await recordCostLog(
    {
      costType: "llm_call",
      callType,
      provider: "openai",
      model: cost.model,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      costUsd: cost.costUsd,
      userId: context.userId,
      analysedVideoId: context.analysedVideoId,
      userEmail: context.userEmail,
    },
    admin,
  )
}

// Convenience for a Qencode transcoding job: a 'qencode_transcode' cost with no
// call type, model or tokens — just the derived dollar cost against the
// user/video whose upload was transcoded.
export async function recordTranscodingCall(
  costUsd: number,
  context: LlmLogContext,
  admin?: SupabaseClient,
): Promise<void> {
  await recordCostLog(
    {
      costType: "qencode_transcode",
      callType: null,
      provider: "qencode",
      model: null,
      costUsd,
      userId: context.userId,
      analysedVideoId: context.analysedVideoId,
      userEmail: context.userEmail,
    },
    admin,
  )
}
