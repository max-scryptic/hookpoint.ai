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
  "script_taxonomy",
  "script_comparison",
  "packaging_comparison",
  "retention_attribution",
  "snapshot",
  "audio",
  "event_synthesis",
  "transcript_taxonomy",
] as const

export type LlmCallType = (typeof LLM_CALL_TYPES)[number]

export const LLM_CALL_TYPE_LABELS: Record<LlmCallType, string> = {
  pacing: "Light analysis · pacing",
  packaging_alignment: "Packaging analysis · alignment",
  packaging_taxonomy: "Packaging analysis · taxonomy",
  script_taxonomy: "Script analysis · taxonomy",
  script_comparison: "Video comparison · script report",
  packaging_comparison: "Video comparison · packaging report",
  retention_attribution: "Light analysis · retention attribution",
  snapshot: "Deep video analysis · snapshot",
  audio: "Deep video analysis · audio",
  event_synthesis: "Deep video analysis · event synthesis",
  transcript_taxonomy: "Deep video analysis · transcript taxonomy",
}

// The two kinds of LLM work we bill for, one level above call_type: the
// analysis pipeline a video goes through (light *and* deep — pacing, packaging,
// snapshots, audio, synthesis …) and the comparison reports generated between
// two videos. Every LLM call belongs to exactly one, which is what lets the
// admin cost surfaces filter and total them apart.
export const LLM_CALL_GROUPS = ["analysis", "comparison"] as const

export type LlmCallGroup = (typeof LLM_CALL_GROUPS)[number]

export const LLM_CALL_GROUP_LABELS: Record<LlmCallGroup, string> = {
  analysis: "analysis",
  comparison: "comparisons",
}

// The comparison-report calls — every other LLM call type is analysis work.
const COMPARISON_LLM_CALL_TYPES = new Set<LlmCallType>([
  "script_comparison",
  "packaging_comparison",
])

// Classifies an LLM call into its group. A call with no type recorded counts as
// analysis, matching how analysisCostBucket treats an untyped call as light.
export function llmCallGroup(callType: LlmCallType | null): LlmCallGroup {
  return callType && COMPARISON_LLM_CALL_TYPES.has(callType)
    ? "comparison"
    : "analysis"
}

// The call types each group covers, in the canonical LLM_CALL_TYPES order, so
// the admin filters can narrow the call-type list to whichever group is picked.
export const LLM_CALL_TYPES_BY_GROUP: Record<LlmCallGroup, LlmCallType[]> = {
  analysis: LLM_CALL_TYPES.filter((type) => llmCallGroup(type) === "analysis"),
  comparison: LLM_CALL_TYPES.filter(
    (type) => llmCallGroup(type) === "comparison",
  ),
}

// The choices the admin cost-log "cost type" filter offers. It is one dropdown
// over two underlying filters — the cost type and (for LLM calls) the call
// group — so an admin can pick all LLM calls, just the analysis ones, just the
// comparison reports, or transcoding, without a second widget.
export const COST_SCOPES = [
  "llm_call",
  "llm_call:analysis",
  "llm_call:comparison",
  "qencode_transcode",
] as const

export type CostScope = (typeof COST_SCOPES)[number]

export const COST_SCOPE_LABELS: Record<CostScope, string> = {
  llm_call: "All LLM calls",
  "llm_call:analysis": "LLM calls · analysis",
  "llm_call:comparison": "LLM calls · comparison reports",
  qencode_transcode: "Qencode Transcode",
}

// The dropdown value for a (cost type, call group) pair — the empty string when
// no cost filter is applied ("All cost types").
export function costScopeValue(
  costType?: CostType,
  callGroup?: LlmCallGroup,
): CostScope | "" {
  if (!costType) return ""
  if (costType !== "llm_call") return costType
  return callGroup ? (`llm_call:${callGroup}` as CostScope) : "llm_call"
}

// The inverse: the cost type and call group a dropdown value filters by. An
// unrecognised value clears both, so a hand-edited query string degrades to
// "All cost types" rather than filtering everything out.
export function costScopeFilters(value?: string): {
  costType?: CostType
  callGroup?: LlmCallGroup
} {
  if (!value || !(COST_SCOPES as readonly string[]).includes(value)) return {}
  const [costType, callGroup] = value.split(":")
  return {
    costType: costType as CostType,
    callGroup: callGroup as LlmCallGroup | undefined,
  }
}

// The call-type filter that survives a change of cost scope: kept when the new
// scope still covers that call type, cleared otherwise. Without this an admin
// who picks "comparison reports" while a pacing call type is selected would be
// left with two filters that contradict into an empty table.
export function callTypeInScope(
  scope?: string,
  callType?: LlmCallType | null,
): LlmCallType | undefined {
  if (!callType) return undefined
  const { costType, callGroup } = costScopeFilters(scope)
  if (costType === "qencode_transcode") return undefined
  if (callGroup && llmCallGroup(callType) !== callGroup) return undefined
  return callType
}

// The two spend buckets a video's costs roll up into. "Light analysis" is the
// initial analysis every video goes through (pacing, retention attribution and
// packaging); "Deep analysis" is the opt-in source-file deep dive (snapshot,
// audio and event synthesis LLM calls plus the one-time Qencode transcode).
export type AnalysisCostBucket = "light" | "deep"

// The deep-dive LLM calls — everything else logged against a video is light.
const DEEP_LLM_CALL_TYPES = new Set<LlmCallType>([
  "snapshot",
  "audio",
  "event_synthesis",
  "transcript_taxonomy",
])

// Classifies a logged cost into its light/deep bucket. Qencode transcodes only
// happen to prepare a source file for the deep dive, so they count as deep; the
// deep-dive LLM calls are enumerated above and everything else is light. Kept
// here (with the labels) so both the read helper and any UI can share one rule.
export function analysisCostBucket(
  costType: CostType,
  callType: LlmCallType | null,
): AnalysisCostBucket {
  if (costType === "qencode_transcode") return "deep"
  if (callType && DEEP_LLM_CALL_TYPES.has(callType)) return "deep"
  return "light"
}

export type LlmCallProvider = "openai" | "qencode"

// Who/what a logged call belongs to. Threaded into the generate* functions so
// they can record their own spend at the source.
export interface LlmLogContext {
  userId?: string | null
  analysedVideoId?: string | null
  userEmail?: string | null
}
