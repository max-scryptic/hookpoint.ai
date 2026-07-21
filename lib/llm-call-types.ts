// Pure, dependency-free constants and types for the cost log, safe to import
// from client components (the admin filters) as well as server code. The
// write-side helpers live in lib/llm-calls.ts, which imports the service-role
// client and must therefore never be pulled into a client bundle — keeping
// these here is what lets the filter UI import the labels/types without
// dragging that server-only code along.

// The broad category of a logged cost. Kept in sync with the cost_type check
// constraint in the 20260720130000_create_cost_logs migration. This is the
// top-level split; call_type below only further breaks down LLM calls.
export const COST_TYPES = ["llm_call", "qencode_transcode"] as const

export type CostType = (typeof COST_TYPES)[number]

export const COST_TYPE_LABELS: Record<CostType, string> = {
  llm_call: "LLM call",
  qencode_transcode: "Qencode Transcode",
}

// The specific kind of LLM call — the variety of LLM work we do. Kept in sync
// with the call_type check constraint in the migration. Only meaningful for the
// 'llm_call' cost type; a Qencode transcode has no call_type. The `_LABELS` map
// is the human wording shown in the admin table and its type filter.
export const LLM_CALL_TYPES = [
  "pacing",
  "packaging_alignment",
  "packaging_taxonomy",
  "retention_attribution",
  "snapshot",
  "audio",
  "event_synthesis",
] as const

export type LlmCallType = (typeof LLM_CALL_TYPES)[number]

export const LLM_CALL_TYPE_LABELS: Record<LlmCallType, string> = {
  pacing: "Light analysis · pacing",
  packaging_alignment: "Packaging analysis · alignment",
  packaging_taxonomy: "Packaging analysis · taxonomy",
  retention_attribution: "Light analysis · retention attribution",
  snapshot: "Deep video analysis · snapshot",
  audio: "Deep video analysis · audio",
  event_synthesis: "Deep video analysis · event synthesis",
}

export type LlmCallProvider = "openai" | "qencode"

// Who/what a logged call belongs to. Threaded into the generate* functions so
// they can record their own spend at the source.
export interface LlmLogContext {
  userId?: string | null
  analysedVideoId?: string | null
  userEmail?: string | null
}
