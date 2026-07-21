// Pure, dependency-free constants and types for the LLM call log, safe to
// import from client components (the admin filters) as well as server code.
// The write-side helpers live in lib/llm-calls.ts, which imports the
// service-role client and must therefore never be pulled into a client bundle —
// keeping these here is what lets the filter UI import the labels/types without
// dragging that server-only code along.

// The kinds of call tracked. Kept in sync with the call_type check constraint
// in the 20260720130000_create_llm_calls migration. The `_LABELS` map is the
// human wording shown in the admin table and its type filter.
export const LLM_CALL_TYPES = [
  "pacing",
  "packaging_alignment",
  "packaging_taxonomy",
  "retention_attribution",
  "snapshot",
  "audio",
  "event_synthesis",
  "transcoding",
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
  transcoding: "Qencode transcoding",
}

export type LlmCallProvider = "openai" | "qencode"

// Who/what a logged call belongs to. Threaded into the generate* functions so
// they can record their own spend at the source.
export interface LlmLogContext {
  userId?: string | null
  analysedVideoId?: string | null
  userEmail?: string | null
}
