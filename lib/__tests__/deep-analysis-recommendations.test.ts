import { describe, expect, it } from "vitest"

import {
  compileDeepAnalysisRecommendations,
  dedupeDeepAnalysisRecommendations,
} from "@/lib/deep-analysis-recommendations"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

const window = {
  id: "window-1",
  kind: "drop_off",
  delta: -0.08,
} as PersistedRetentionWindow

function event(overrides: Partial<RankedRetentionWindowEvent> = {}): RankedRetentionWindowEvent {
  return {
    id: "event-1",
    retentionWindowId: "window-1",
    eventIndex: 0,
    eventType: "audio_change",
    timestampSeconds: 42,
    narrative: "The audio loses momentum here.",
    primaryEvidence: "audio",
    confidence: 0.8,
    signals: null,
    insightScore: 0.82,
    evidenceCompleteness: 1,
    evidenceQuality: "high",
    insightRank: 1,
    ...overrides,
  }
}

describe("compileDeepAnalysisRecommendations", () => {
  it("turns measured silence into a cautious trim recommendation", () => {
    const recommendations = compileDeepAnalysisRecommendations({
      events: [event()],
      window,
      editing: null,
      baseline: { cutsPerMinute: 8, speechRate: 150 },
      audio: { silence: 0.2 } as never,
    })
    expect(recommendations[0]).toMatchObject({ actionType: "trim_silence" })
    expect(recommendations[0].action).toContain("Trim")
    expect(recommendations[0].expectedPurpose).toContain("Test")
  })

  it("preserves a successful pattern for a gain", () => {
    const recommendations = compileDeepAnalysisRecommendations({
      events: [event()],
      window: { ...window, kind: "gain" },
      editing: null,
      baseline: { cutsPerMinute: null, speechRate: null },
      audio: null,
    })
    expect(recommendations[0].actionType).toBe("preserve_pattern")
  })

  it("deduplicates the same nearby action across overlapping windows", () => {
    const first = compileDeepAnalysisRecommendations({
      events: [event()], window, editing: null,
      baseline: { cutsPerMinute: null, speechRate: null },
      audio: { silence: 0.2 } as never,
    })
    const second = compileDeepAnalysisRecommendations({
      events: [event({ id: "event-2", timestampSeconds: 50, insightScore: 0.7 })],
      window: { ...window, id: "window-2" }, editing: null,
      baseline: { cutsPerMinute: null, speechRate: null },
      audio: { silence: 0.2 } as never,
    })
    dedupeDeepAnalysisRecommendations([first, second])
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })
})
