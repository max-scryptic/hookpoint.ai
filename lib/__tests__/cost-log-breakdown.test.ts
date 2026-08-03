import { describe, expect, it } from "vitest"

import { costLogBreakdown } from "@/lib/cost-log-breakdown"
import type { CostLogBreakdownInput } from "@/lib/cost-log-breakdown"

function llm(
  callType: CostLogBreakdownInput["callType"],
  costUsd: number,
): CostLogBreakdownInput {
  return { costType: "llm_call", callType, costUsd }
}

function transcode(costUsd: number): CostLogBreakdownInput {
  return { costType: "qencode_transcode", callType: null, costUsd }
}

describe("costLogBreakdown", () => {
  it("returns nothing for no rows", () => {
    expect(costLogBreakdown([])).toEqual([])
  })

  it("splits the LLM total into analysis and comparison spend", () => {
    const breakdown = costLogBreakdown([
      llm("pacing", 1),
      llm("snapshot", 2),
      llm("script_comparison", 3),
      llm("packaging_comparison", 4),
    ])

    expect(breakdown).toEqual([
      {
        type: "llm_call",
        total: 10,
        groups: [
          { group: "analysis", total: 3 },
          { group: "comparison", total: 7 },
        ],
      },
    ])
  })

  it("reports both groups even when one has no spend", () => {
    const breakdown = costLogBreakdown([llm("pacing", 1)])

    expect(breakdown[0].groups).toEqual([
      { group: "analysis", total: 1 },
      { group: "comparison", total: 0 },
    ])
  })

  it("counts an LLM call with no recorded type as analysis", () => {
    const breakdown = costLogBreakdown([llm(null, 5)])

    expect(breakdown[0].groups).toEqual([
      { group: "analysis", total: 5 },
      { group: "comparison", total: 0 },
    ])
  })

  it("gives transcodes no group split and orders types by spend", () => {
    const breakdown = costLogBreakdown([llm("pacing", 1), transcode(9)])

    expect(breakdown.map((entry) => entry.type)).toEqual([
      "qencode_transcode",
      "llm_call",
    ])
    expect(breakdown[0].groups).toEqual([])
  })

  it("totals the parts to the same figure as the grand total", () => {
    const rows = [
      llm("audio", 0.5),
      llm("packaging_comparison", 0.25),
      transcode(1.25),
    ]

    const breakdown = costLogBreakdown(rows)
    const grandTotal = rows.reduce((sum, row) => sum + row.costUsd, 0)

    expect(breakdown.reduce((sum, entry) => sum + entry.total, 0)).toBeCloseTo(
      grandTotal,
    )
    const llmEntry = breakdown.find((entry) => entry.type === "llm_call")!
    expect(
      llmEntry.groups.reduce((sum, group) => sum + group.total, 0),
    ).toBeCloseTo(llmEntry.total)
  })
})
