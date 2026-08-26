import {
  LLM_CALL_GROUPS,
  llmCallGroup,
  type CostType,
  type LlmCallGroup,
  type LlmCallType,
} from "@/lib/llm-call-types"

// The summary line both admin cost-log surfaces show above their table: what
// the listed rows cost, split by cost type, with the LLM spend further split
// into the analysis and comparison-report groups. Pure and dependency-free so
// the server page and the client-side panel can share one rule (and so it can
// be unit tested without a database).

// The minimum a row needs to expose to be totalled - deliberately structural so
// this module doesn't have to reach into the admin (server-only) read helpers.
export interface CostLogBreakdownInput {
  costType: CostType
  callType: LlmCallType | null
  costUsd: number
}

export interface CostLogGroupTotal {
  group: LlmCallGroup
  total: number
}

export interface CostLogBreakdownEntry {
  type: CostType
  total: number
  // The analysis/comparison split, in LLM_CALL_GROUPS order. Only populated for
  // the llm_call type; a transcode has no call group to split by.
  groups: CostLogGroupTotal[]
}

// Per-cost-type spend for the given rows, largest first, so the summary line
// can break the total down by type. Summed from the same (capped) rows the
// caller lists, so the parts always add up to the total it shows. Both LLM
// groups are always reported once any LLM cost is present - a $0.00 comparison
// figure is itself the answer to "what did comparisons cost", and keeping both
// makes the line's shape stable as filters change.
export function costLogBreakdown(
  rows: CostLogBreakdownInput[],
): CostLogBreakdownEntry[] {
  const byType = new Map<CostType, number>()
  const llmByGroup = new Map<LlmCallGroup, number>()

  for (const row of rows) {
    byType.set(row.costType, (byType.get(row.costType) ?? 0) + row.costUsd)
    if (row.costType === "llm_call") {
      const group = llmCallGroup(row.callType)
      llmByGroup.set(group, (llmByGroup.get(group) ?? 0) + row.costUsd)
    }
  }

  return Array.from(byType.entries())
    .map(([type, total]) => ({
      type,
      total,
      groups:
        type === "llm_call"
          ? LLM_CALL_GROUPS.map((group) => ({
              group,
              total: llmByGroup.get(group) ?? 0,
            }))
          : [],
    }))
    .sort((a, b) => b.total - a.total)
}
