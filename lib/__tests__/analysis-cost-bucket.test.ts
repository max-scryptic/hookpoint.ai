import { describe, expect, it } from "vitest"

import { analysisCostBucket, LLM_CALL_TYPES } from "@/lib/llm-call-types"

describe("analysisCostBucket", () => {
  it("counts the deep-dive LLM calls as deep", () => {
    expect(analysisCostBucket("llm_call", "snapshot")).toBe("deep")
    expect(analysisCostBucket("llm_call", "audio")).toBe("deep")
    expect(analysisCostBucket("llm_call", "event_synthesis")).toBe("deep")
  })

  it("counts the initial-analysis LLM calls as light", () => {
    expect(analysisCostBucket("llm_call", "pacing")).toBe("light")
    expect(analysisCostBucket("llm_call", "retention_attribution")).toBe(
      "light",
    )
    expect(analysisCostBucket("llm_call", "packaging_alignment")).toBe("light")
    expect(analysisCostBucket("llm_call", "packaging_taxonomy")).toBe("light")
  })

  it("treats a Qencode transcode as deep - it only prepares a source file", () => {
    expect(analysisCostBucket("qencode_transcode", null)).toBe("deep")
  })

  it("falls back to light for an llm_call with no call type", () => {
    expect(analysisCostBucket("llm_call", null)).toBe("light")
  })

  it("classifies every known LLM call type into one bucket", () => {
    for (const callType of LLM_CALL_TYPES) {
      expect(["light", "deep"]).toContain(
        analysisCostBucket("llm_call", callType),
      )
    }
  })
})
