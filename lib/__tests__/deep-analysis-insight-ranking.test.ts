import { describe, expect, it } from "vitest"

import { rankRetentionWindowInsights } from "@/lib/deep-analysis-insight-ranking"
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
    signals: null,
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
      window: { delta: -0.09, steepness: 2.5 },
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
      window: { delta: -0.09, steepness: 2.5 },
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
      window: { delta: -0.03, steepness: 0.5 },
      evidence: { ...completeEvidence, hasAudio: false },
    })
    expect(ranked).toEqual([])
  })
})
