import { describe, expect, it } from "vitest"

import {
  callTypeInScope,
  COST_SCOPES,
  costScopeFilters,
  costScopeValue,
  LLM_CALL_TYPES,
  LLM_CALL_TYPES_BY_GROUP,
  llmCallGroup,
} from "@/lib/llm-call-types"

describe("llmCallGroup", () => {
  it("counts the two comparison reports as comparison work", () => {
    expect(llmCallGroup("script_comparison")).toBe("comparison")
    expect(llmCallGroup("packaging_comparison")).toBe("comparison")
  })

  it("counts light and deep analysis calls alike as analysis work", () => {
    expect(llmCallGroup("pacing")).toBe("analysis")
    expect(llmCallGroup("retention_attribution")).toBe("analysis")
    expect(llmCallGroup("snapshot")).toBe("analysis")
    expect(llmCallGroup("event_synthesis")).toBe("analysis")
  })

  it("falls back to analysis for a call with no type", () => {
    expect(llmCallGroup(null)).toBe("analysis")
  })

  it("puts every known call type in exactly one group", () => {
    const grouped = [
      ...LLM_CALL_TYPES_BY_GROUP.analysis,
      ...LLM_CALL_TYPES_BY_GROUP.comparison,
    ]
    expect(grouped.sort()).toEqual([...LLM_CALL_TYPES].sort())
  })
})

describe("cost scopes", () => {
  it("round-trips every scope through its filters", () => {
    for (const scope of COST_SCOPES) {
      const { costType, callGroup } = costScopeFilters(scope)
      expect(costScopeValue(costType, callGroup)).toBe(scope)
    }
  })

  it("reads as no filter when nothing is selected", () => {
    expect(costScopeValue(undefined, undefined)).toBe("")
    expect(costScopeFilters(undefined)).toEqual({})
    expect(costScopeFilters("")).toEqual({})
  })

  it("ignores an unrecognised value rather than filtering on it", () => {
    expect(costScopeFilters("llm_call:bogus")).toEqual({})
    expect(costScopeFilters("nonsense")).toEqual({})
  })

  it("maps the LLM scopes to a cost type and group", () => {
    expect(costScopeFilters("llm_call")).toEqual({
      costType: "llm_call",
      callGroup: undefined,
    })
    expect(costScopeFilters("llm_call:comparison")).toEqual({
      costType: "llm_call",
      callGroup: "comparison",
    })
    expect(costScopeFilters("qencode_transcode")).toEqual({
      costType: "qencode_transcode",
      callGroup: undefined,
    })
  })
})

describe("callTypeInScope", () => {
  it("keeps a call type the new scope still covers", () => {
    expect(callTypeInScope("llm_call", "pacing")).toBe("pacing")
    expect(callTypeInScope("llm_call:analysis", "pacing")).toBe("pacing")
    expect(callTypeInScope("llm_call:comparison", "script_comparison")).toBe(
      "script_comparison",
    )
    expect(callTypeInScope(undefined, "pacing")).toBe("pacing")
  })

  it("drops a call type the new scope excludes", () => {
    expect(callTypeInScope("llm_call:comparison", "pacing")).toBeUndefined()
    expect(
      callTypeInScope("llm_call:analysis", "script_comparison"),
    ).toBeUndefined()
    expect(callTypeInScope("qencode_transcode", "pacing")).toBeUndefined()
  })
})
