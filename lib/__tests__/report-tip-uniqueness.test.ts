import { describe, expect, it } from "vitest"

import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import {
  createFirstSaying,
  dedupePacingTips,
  dedupeSectionTips,
  type DeepWindowFeedback,
  type RetentionSectionFeedback,
} from "@/lib/report-tip-uniqueness"
import type { RetentionMomentAttribution } from "@/lib/retention-attribution"

const PACING_TIP =
  "Plan at least one purposeful visual change for a stretch like this: B-roll, a crop change, a demonstration, or concise on-screen text."
const SIGNPOST_TIP =
  "Signpost a shift like this before you make it: say what is coming and why it matters to what viewers came for."

function moment(
  windowIndex: number,
  tip: string | null,
): RetentionMomentAttribution {
  return {
    kind: "drop_off",
    windowIndex,
    fromSeconds: windowIndex * 60,
    toSeconds: windowIndex * 60 + 20,
    explanation: "Viewers left while the point was still being set up.",
    tip,
    tipWarrant: tip == null ? 0 : 0.8,
    confidence: 0.7,
  }
}

function deep(windowIndex: number, action: string | null): DeepWindowFeedback {
  return {
    insight: {
      id: `event-${windowIndex}`,
      narrative: "The pacing slows here.",
    } as never,
    recommendation:
      action == null
        ? undefined
        : ({ id: `rec-${windowIndex}`, action } as DeepAnalysisRecommendation),
  }
}

function section(
  moments: RetentionMomentAttribution[],
  deepFeedback: Array<[number, DeepWindowFeedback[]]>,
): RetentionSectionFeedback {
  return {
    attribution: new Map(moments.map((entry) => [entry.windowIndex, entry])),
    deepFeedback: new Map(deepFeedback),
  }
}

describe("dedupeSectionTips", () => {
  // The report that prompted this: three drop-offs minutes apart, each showing
  // the same synthesised recommendation word for word.
  it("keeps a repeated deep tip on the first window only", () => {
    const result = dedupeSectionTips(
      section(
        [],
        [
          [0, [deep(0, PACING_TIP)]],
          [1, [deep(1, PACING_TIP)]],
          [2, [deep(2, PACING_TIP)]],
        ],
      ),
      createFirstSaying(),
    )

    expect(result.deepFeedback.get(0)?.[0].recommendation?.action).toBe(PACING_TIP)
    expect(result.deepFeedback.get(1)?.[0].recommendation).toBeUndefined()
    expect(result.deepFeedback.get(2)?.[0].recommendation).toBeUndefined()
    // The evidence behind the dropped tip is still there to read.
    expect(result.deepFeedback.get(2)?.[0].insight.narrative).toBe(
      "The pacing slows here.",
    )
  })

  it("drops a script tip that restates one from an earlier window", () => {
    const result = dedupeSectionTips(
      section(
        [
          moment(0, "Open a new section by naming the payoff it delivers."),
          moment(1, "Open each new section by naming the payoff it delivers."),
          moment(2, "Hold the shot for a beat before the first cut."),
        ],
        [],
      ),
      createFirstSaying(),
    )

    expect(result.attribution.get(0)?.tip).toBe(
      "Open a new section by naming the payoff it delivers.",
    )
    expect(result.attribution.get(1)?.tip).toBeNull()
    expect(result.attribution.get(2)?.tip).toBe(
      "Hold the shot for a beat before the first cut.",
    )
  })

  // Both writers describe the same moment, so page order cannot separate them.
  // The deep tip is measured off the frames and the audio; the script tip is
  // inferred from the transcript by a pass that cannot see either. The
  // better-evidenced one keeps the advice.
  it("keeps a window's deep tip over its script tip when they repeat each other", () => {
    const result = dedupeSectionTips(
      section([moment(0, PACING_TIP)], [[0, [deep(0, PACING_TIP)]]]),
      createFirstSaying(),
    )

    expect(result.deepFeedback.get(0)?.[0].recommendation?.action).toBe(PACING_TIP)
    expect(result.attribution.get(0)?.tip).toBeNull()
  })

  // The window's own deep tip outranks its script tip, but only within that
  // window: a tip already said further up the page still wins on page order.
  it("does not let a later window's deep tip beat an earlier window's script tip", () => {
    const result = dedupeSectionTips(
      section([moment(0, PACING_TIP)], [[1, [deep(1, PACING_TIP)]]]),
      createFirstSaying(),
    )

    expect(result.attribution.get(0)?.tip).toBe(PACING_TIP)
    expect(result.deepFeedback.get(1)?.[0].recommendation).toBeUndefined()
  })

  it("carries what it has said from one section into the next", () => {
    const isFirstSaying = createFirstSaying()
    const drops = dedupeSectionTips(
      section([moment(0, PACING_TIP)], []),
      isFirstSaying,
    )
    const gains = dedupeSectionTips(
      section([moment(0, PACING_TIP), moment(1, SIGNPOST_TIP)], []),
      isFirstSaying,
    )

    expect(drops.attribution.get(0)?.tip).toBe(PACING_TIP)
    expect(gains.attribution.get(0)?.tip).toBeNull()
    expect(gains.attribution.get(1)?.tip).toBe(SIGNPOST_TIP)
  })

  it("walks the windows in the order they are listed, not the order they arrived", () => {
    const result = dedupeSectionTips(
      section([moment(2, PACING_TIP), moment(0, PACING_TIP)], []),
      createFirstSaying(),
    )

    expect(result.attribution.get(0)?.tip).toBe(PACING_TIP)
    expect(result.attribution.get(2)?.tip).toBeNull()
  })

  it("leaves distinct tips and tipless windows alone", () => {
    const input = section(
      [moment(0, SIGNPOST_TIP), moment(1, null)],
      [[0, [deep(0, PACING_TIP), deep(0, null)]]],
    )
    const result = dedupeSectionTips(input, createFirstSaying())

    expect(result.attribution.get(0)?.tip).toBe(SIGNPOST_TIP)
    expect(result.attribution.get(1)?.tip).toBeNull()
    expect(result.deepFeedback.get(0)?.[0].recommendation?.action).toBe(PACING_TIP)
    expect(result.deepFeedback.get(0)?.[1].recommendation).toBeUndefined()
  })

  // These come in as server-rendered props, so a dropped tip has to be dropped
  // from a copy: editing the props in place would strip the tip out of whatever
  // else on the page is reading the same object.
  it("drops a repeat without touching what it was given", () => {
    const input = section([moment(0, PACING_TIP), moment(1, PACING_TIP)], [])
    const result = dedupeSectionTips(input, createFirstSaying())

    expect(result.attribution.get(1)?.tip).toBeNull()
    expect(input.attribution.get(1)?.tip).toBe(PACING_TIP)
    expect(input.attribution).not.toBe(result.attribution)
  })
})

describe("dedupePacingTips", () => {
  function analysis(
    stretches: Array<{ startSeconds: number; suggestion: string }>,
  ): PacingAnalysis {
    return {
      slowOrRepetitiveStretches: stretches.map((stretch) => ({
        startSeconds: stretch.startSeconds,
        endSeconds: stretch.startSeconds + 30,
        reason: "The section repeats itself.",
        suggestion: stretch.suggestion,
      })),
    } as PacingAnalysis
  }

  it("blanks a suggestion the report has already made", () => {
    const isFirstSaying = createFirstSaying()
    dedupeSectionTips(section([moment(0, PACING_TIP)], []), isFirstSaying)
    const result = dedupePacingTips(
      analysis([
        { startSeconds: 120, suggestion: PACING_TIP },
        { startSeconds: 240, suggestion: SIGNPOST_TIP },
      ]),
      isFirstSaying,
    )

    expect(result?.slowOrRepetitiveStretches[0].suggestion).toBe("")
    expect(result?.slowOrRepetitiveStretches[1].suggestion).toBe(SIGNPOST_TIP)
    // Blanking the tip leaves the stretch itself on the list.
    expect(result?.slowOrRepetitiveStretches).toHaveLength(2)
    expect(result?.slowOrRepetitiveStretches[0].reason).toBe(
      "The section repeats itself.",
    )
  })

  it("keeps the earliest stretch's wording when two of them repeat", () => {
    const result = dedupePacingTips(
      analysis([
        { startSeconds: 300, suggestion: PACING_TIP },
        { startSeconds: 60, suggestion: PACING_TIP },
      ]),
      createFirstSaying(),
    )

    expect(result?.slowOrRepetitiveStretches[0].startSeconds).toBe(60)
    expect(result?.slowOrRepetitiveStretches[0].suggestion).toBe(PACING_TIP)
    expect(result?.slowOrRepetitiveStretches[1].suggestion).toBe("")
  })

  it("passes a missing analysis through", () => {
    expect(dedupePacingTips(null, createFirstSaying())).toBeNull()
  })
})
