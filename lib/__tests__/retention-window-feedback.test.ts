import { describe, expect, it } from "vitest"

import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import type { DeepWindowFeedback } from "@/lib/report-tip-uniqueness"
import type { RetentionMomentAttribution } from "@/lib/retention-attribution"
import {
  dedupeDeepFeedback,
  hasScriptFeedback,
  hasWindowTip,
  resolveWindowFeedback,
} from "@/lib/retention-window-feedback"

function insight(
  overrides: Partial<RankedRetentionWindowEvent> = {},
): RankedRetentionWindowEvent {
  return {
    id: "event-1",
    retentionWindowId: "window-1",
    eventIndex: 0,
    eventType: "visual_change",
    timestampSeconds: 906.8,
    narrative: "The gameplay screen fills the frame for the whole stretch.",
    primaryEvidence: "visual",
    confidence: 0.8,
    insightScore: 0.82,
    evidenceCompleteness: 1,
    evidenceQuality: "high",
    insightRank: 1,
    ...overrides,
  } as RankedRetentionWindowEvent
}

function recommendation(action: string): DeepAnalysisRecommendation {
  return {
    id: `rec-${action}`,
    sourceEventId: "event-1",
    timestampSeconds: 906.8,
    actionType: "sustain_attention",
    action,
    expectedPurpose: "Hold the same attention for longer.",
    rationale: "Measured over the window's frames and audio.",
    evidenceQuality: "high",
    insightScore: 0.82,
  } as DeepAnalysisRecommendation
}

function attribution(
  overrides: Partial<RetentionMomentAttribution> = {},
): RetentionMomentAttribution {
  return {
    kind: "hold",
    windowIndex: 0,
    fromSeconds: 860,
    toSeconds: 888,
    explanation: "You are talking through the last push of the match here.",
    tip: null,
    tipWarrant: 0,
    confidence: 0.7,
    ...overrides,
  }
}

describe("dedupeDeepFeedback", () => {
  it("drops an insight that never produced a tip", () => {
    const feedback: DeepWindowFeedback[] = [{ insight: insight() }]
    expect(dedupeDeepFeedback(feedback)).toEqual([])
  })

  it("keeps one entry per distinct tip", () => {
    const feedback: DeepWindowFeedback[] = [
      { insight: insight({ id: "a" }), recommendation: recommendation("Plan a long section") },
      { insight: insight({ id: "b" }), recommendation: recommendation("Plan a long section") },
      { insight: insight({ id: "c" }), recommendation: recommendation("Leave a question open") },
    ]
    expect(dedupeDeepFeedback(feedback).map((entry) => entry.insight.id)).toEqual([
      "a",
      "c",
    ])
  })
})

describe("hasScriptFeedback", () => {
  it("is false without an attribution or with an empty explanation", () => {
    expect(hasScriptFeedback(undefined)).toBe(false)
    expect(hasScriptFeedback(attribution({ explanation: "" }))).toBe(false)
  })

  it("is true for an explanation with no tip behind it", () => {
    expect(hasScriptFeedback(attribution())).toBe(true)
  })
})

describe("resolveWindowFeedback", () => {
  it("drops a script reading with no tip under it, deep tabs or not", () => {
    // The case the report grew when deep analysis finished: the transcript pass
    // explained the window but had no advice to give, so the frames and the
    // audio are the only things worth a tab and the first of them leads.
    const deepFeedback: DeepWindowFeedback[] = [
      {
        insight: insight({ id: "a", eventType: "topic_shift" }),
        recommendation: recommendation("Open on the trade itself"),
      },
      {
        insight: insight({ id: "b" }),
        recommendation: recommendation("Cut to the chart while you talk"),
      },
    ]
    const resolved = resolveWindowFeedback(attribution(), deepFeedback)
    expect(resolved.script).toBeNull()
    expect(resolved.deep.map((entry) => entry.insight.id)).toEqual(["a", "b"])

    expect(resolveWindowFeedback(attribution(), []).script).toBeNull()
    expect(resolveWindowFeedback(attribution({ tip: "  " }), []).script).toBeNull()
  })

  it("keeps a script reading that carries a tip of its own", () => {
    const withTip = attribution({ tip: "Cut the recap and open on the play" })
    expect(resolveWindowFeedback(withTip, []).script).toBe(withTip)
  })

  it("drops a script tip a deep tab already carries", () => {
    // Both passes reached the same advice; the one that can show its frames
    // keeps it, and the script reading is left with nothing to add.
    const tip = "Cut to the chart while you talk"
    const resolved = resolveWindowFeedback(attribution({ tip }), [
      { insight: insight(), recommendation: recommendation(tip) },
    ])
    expect(resolved.script).toBeNull()
    expect(resolved.deep).toHaveLength(1)
  })

  it("drops a tip whose explanation never renders", () => {
    expect(
      resolveWindowFeedback(
        attribution({ explanation: "", tip: "Cut the recap" }),
        [],
      ).script,
    ).toBeNull()
  })
})

describe("hasWindowTip", () => {
  it("is false for a window neither pass said anything about", () => {
    expect(hasWindowTip(undefined, [])).toBe(false)
  })

  it("is false when the deep insights all lost their recommendations", () => {
    // What the report's uniqueness pass leaves behind when a window's only tip
    // repeats one made higher up the page: the insight stays, its tip does not,
    // and no tab is drawn for it.
    expect(hasWindowTip(undefined, [{ insight: insight() }])).toBe(false)
  })

  it("is false for an explanation with no tip under it", () => {
    // The reason a window can be read, explained, and still not earn a row: the
    // creator can see the drop on the curve already, so a restatement of it is
    // not a finding.
    expect(hasWindowTip(attribution(), [])).toBe(false)
    expect(hasWindowTip(attribution({ tip: "   " }), [])).toBe(false)
  })

  it("is true on the script tip alone", () => {
    expect(
      hasWindowTip(attribution({ tip: "Cut the recap and open on the play" }), []),
    ).toBe(true)
  })

  it("is false for a tip whose explanation never renders", () => {
    // Nothing draws a script tip without the reading above it, so a row kept for
    // one would show its header over an empty body.
    expect(
      hasWindowTip(
        attribution({ explanation: "", tip: "Cut the recap" }),
        [],
      ),
    ).toBe(false)
  })

  it("is true on a deep insight that kept its tip", () => {
    expect(
      hasWindowTip(undefined, [
        { insight: insight(), recommendation: recommendation("Plan a long section") },
      ]),
    ).toBe(true)
  })
})
