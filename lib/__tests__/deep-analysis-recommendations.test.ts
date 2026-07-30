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
    expect(recommendations[0].action).toContain("dead air")
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

  it("gives a topic shift structural advice for the next video", () => {
    const recommendations = compileDeepAnalysisRecommendations({
      events: [event({ eventType: "topic_shift", primaryEvidence: "transcript" })],
      window,
      editing: null,
      baseline: { cutsPerMinute: null, speechRate: null },
      audio: null,
    })
    expect(recommendations[0].actionType).toBe("signpost_topic_shift")
    expect(recommendations[0].action).toMatch(/signpost/i)
  })

  // The video being analysed is already live on YouTube, so no recommendation may
  // ask the uploader to change it or to race an alternate cut against the current
  // one. Every branch has to read as advice for the videos they make next.
  it("never asks the uploader to re-edit the published video", () => {
    const cases: Parameters<typeof compileDeepAnalysisRecommendations>[0][] = [
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window: { ...window, kind: "gain" }, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: { freezeCoverage: 0.2 } as never, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: { freezeCoverage: 0, blackCoverage: 0.2 } as never, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: { silence: 0.2 } as never },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: 150 }, audio: { speech_rate: 100 } as never },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: 150 }, audio: { speech_rate: 220 } as never },
      { events: [event()], window, editing: { cutsPerMinute: 2 } as never, baseline: { cutsPerMinute: 10, speechRate: null }, audio: null },
      { events: [event()], window, editing: { cutsPerMinute: 20 } as never, baseline: { cutsPerMinute: 10, speechRate: null }, audio: null },
      { events: [event({ eventType: "topic_shift" })], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event({ primaryEvidence: "visual" })], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
    ]

    const seen = new Set<string>()
    for (const params of cases) {
      const [recommendation] = compileDeepAnalysisRecommendations(params)
      seen.add(recommendation.actionType)
      const copy = `${recommendation.action} ${recommendation.expectedPurpose}`
      expect(copy).not.toMatch(
        /alternate cut|current edit|this edit|re-?edit|re-?cut|re-?upload|against the current/i,
      )
    }

    // Guards the loop itself: if a new branch is added without a case here, the
    // count stops matching and this test asks for the missing coverage.
    expect(seen.size).toBe(10)
  })

  // The tip is already labelled as advice for the next video, so a "next time"
  // lead-in only pushes the action further down the sentence, and reads as a
  // tic once every tip on the page opens the same way. Each action starts on
  // the thing to do.
  it("never opens an action with a forward-looking preamble", () => {
    const cases: Parameters<typeof compileDeepAnalysisRecommendations>[0][] = [
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window: { ...window, kind: "gain" }, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: { freezeCoverage: 0.2 } as never, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: { freezeCoverage: 0, blackCoverage: 0.2 } as never, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: { silence: 0.2 } as never },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: 150 }, audio: { speech_rate: 100 } as never },
      { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: 150 }, audio: { speech_rate: 220 } as never },
      { events: [event()], window, editing: { cutsPerMinute: 2 } as never, baseline: { cutsPerMinute: 10, speechRate: null }, audio: null },
      { events: [event()], window, editing: { cutsPerMinute: 20 } as never, baseline: { cutsPerMinute: 10, speechRate: null }, audio: null },
      { events: [event({ eventType: "topic_shift" })], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
      { events: [event({ primaryEvidence: "visual" })], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
    ]

    for (const params of cases) {
      const [recommendation] = compileDeepAnalysisRecommendations(params)
      expect(recommendation.action).not.toMatch(
        /^(next time|next video|in (your |the )?(next|future)|for (your |the )?(next|future)|going forward|from now on)/i,
      )
    }
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
