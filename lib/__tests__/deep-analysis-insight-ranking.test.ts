import { describe, expect, it } from "vitest"

import {
  rankRetentionWindowInsights,
  type InsightRankingWindow,
} from "@/lib/deep-analysis-insight-ranking"
import type { RetentionWindowEvent } from "@/lib/retention-window-events"

function event(overrides: Partial<RetentionWindowEvent> = {}): RetentionWindowEvent {
  return {
    id: "event-1",
    retentionWindowId: "window-1",
    eventIndex: 0,
    eventType: "pacing_change",
    timestampSeconds: 40,
    narrative: "Your pacing slows substantially in this section.",
    primaryEvidence: "combined",
    confidence: 0.8,
    ...overrides,
  }
}

function window(
  overrides: Partial<InsightRankingWindow> = {},
): InsightRankingWindow {
  return {
    kind: "drop_off",
    delta: -0.09,
    steepness: 2.5,
    fromSeconds: 40,
    toSeconds: 44,
    relativePerformance: null,
    ...overrides,
  }
}

const completeEvidence = {
  hasEditing: true,
  hasVisual: true,
  hasAudio: true,
  hasTranscript: true,
}

describe("rankRetentionWindowInsights", () => {
  it("suppresses weak events and ranks strong corroborated events", () => {
    const ranked = rankRetentionWindowInsights({
      events: [event(), event({ id: "weak", confidence: 0.1, timestampSeconds: 70 })],
      window: window(),
      evidence: completeEvidence,
    })
    expect(ranked.map((item) => item.id)).toEqual(["event-1"])
    expect(ranked[0].evidenceQuality).toBe("high")
  })

  it("removes nearby duplicate events of the same type", () => {
    const ranked = rankRetentionWindowInsights({
      events: [
        event(),
        event({ id: "duplicate", timestampSeconds: 43, confidence: 0.75 }),
      ],
      window: window(),
      evidence: completeEvidence,
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].id).toBe("event-1")
  })

  it("penalizes causal claims when their named modality is missing", () => {
    const ranked = rankRetentionWindowInsights({
      events: [
        event({
          primaryEvidence: "audio",
          narrative: "The audio drop caused viewers to leave.",
          confidence: 0.9,
        }),
      ],
      window: window({ delta: -0.03, steepness: 0.5 }),
      evidence: { ...completeEvidence, hasAudio: false },
    })
    expect(ranked).toEqual([])
  })

  // A hold has a near-zero delta and no steepness by construction, so scoring it
  // on those two numbers charged it for being a hold and left its events under
  // the minimum insight score. That is what left the Holds section with an
  // explanation on every row and a tip on none.
  describe("a hold is scored on what makes a hold notable", () => {
    const hold = window({
      kind: "hold",
      delta: -0.002,
      steepness: null,
      fromSeconds: 120,
      toSeconds: 180,
      relativePerformance: 0.9,
    })

    it("keeps a well-evidenced event on a long, comparatively strong hold", () => {
      const ranked = rankRetentionWindowInsights({
        events: [event({ confidence: 0.7 })],
        window: hold,
        evidence: completeEvidence,
      })
      expect(ranked).toHaveLength(1)
    })

    it("scores the same event above what its flat delta alone would earn", () => {
      const [onHold] = rankRetentionWindowInsights({
        events: [event({ confidence: 0.7 })],
        window: hold,
        evidence: completeEvidence,
      })
      const [asDropOff] = rankRetentionWindowInsights({
        events: [event({ confidence: 0.7 })],
        window: { ...hold, kind: "drop_off" },
        evidence: completeEvidence,
      })
      expect(onHold.insightScore).toBeGreaterThan(asDropOff.insightScore)
    })

    // Scored on its own terms, not waved through: a hold is still a window whose
    // events have to stand up.
    it("still suppresses an event whose evidence does not support it", () => {
      const ranked = rankRetentionWindowInsights({
        events: [
          event({
            primaryEvidence: "audio",
            narrative: "The quiet stretch caused viewers to stay.",
            confidence: 0.6,
          }),
        ],
        window: hold,
        evidence: { ...completeEvidence, hasAudio: false },
      })
      expect(ranked).toEqual([])
    })

    it("ranks a long hold above a barely-detected one", () => {
      const [long] = rankRetentionWindowInsights({
        events: [event()],
        window: hold,
        evidence: completeEvidence,
      })
      const [brief] = rankRetentionWindowInsights({
        events: [event()],
        window: { ...hold, toSeconds: 132, relativePerformance: null },
        evidence: completeEvidence,
      })
      expect(long.insightScore).toBeGreaterThan(brief.insightScore)
    })
  })
})
