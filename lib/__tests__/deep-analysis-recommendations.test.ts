import { describe, expect, it } from "vitest"

import { isNearDuplicateAdvice } from "@/lib/advice-similarity"
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
    expect(recommendations[0].action).toContain("Cut the silence")
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
    expect(recommendations[0].action).toMatch(/before you change subject/i)
  })

  // What the insight is about is measured on the event; freeze coverage, cut
  // rate and the rest are measured on the whole window, so every event in it
  // carries the same ones. Deciding from the window put a tip about visual
  // pacing under an insight about a topic shift, and under the tab named after
  // that topic shift.
  describe("chooses the action from what the insight is about", () => {
    // Straight from the report that prompted this: a structural insight in a
    // window that happened to be cut slowly.
    const slowlyCutWindow = {
      editing: { cutsPerMinute: 0 } as never,
      baseline: { cutsPerMinute: 0.75, speechRate: 150 },
    }

    it("answers a topic shift structurally in a slowly cut window", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "topic_shift", primaryEvidence: "transcript" })],
        window,
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendation.actionType).toBe("signpost_topic_shift")
    })

    it("answers a visual insight visually in a slowly cut window", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "visual_change", primaryEvidence: "visual" })],
        window,
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendation.actionType).toBe("add_visual_support")
    })

    it("lets an editing insight take the cut rate, which is its own subject", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "scene_cut", primaryEvidence: "editing" })],
        window,
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendation.actionType).toBe("increase_visual_pacing")
    })

    it("answers an audio insight from the audio, not from a held frame", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "audio_change", primaryEvidence: "audio" })],
        window,
        editing: { freezeCoverage: 0.2 } as never,
        baseline: { cutsPerMinute: 8, speechRate: 150 },
        audio: { silence: 0.2 } as never,
      })
      expect(recommendation.actionType).toBe("trim_silence")
    })

    it("reads a pacing insight as the delivery before the edit", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "pacing_change", primaryEvidence: "combined" })],
        window,
        editing: { cutsPerMinute: 0 } as never,
        baseline: { cutsPerMinute: 0.75, speechRate: 150 },
        audio: { speech_rate: 100 } as never,
      })
      expect(recommendation.actionType).toBe("adjust_delivery")
    })

    // The subject leads, but it cannot invent a measurement it does not have.
    it("falls back to what the window measured when the subject has nothing", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "audio_change", primaryEvidence: "audio" })],
        window,
        editing: { freezeCoverage: 0.2 } as never,
        baseline: { cutsPerMinute: 8, speechRate: 150 },
        audio: null,
      })
      expect(recommendation.actionType).toBe("replace_freeze")
    })

    it("leaves an event that names no subject to the window measurements", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "other", primaryEvidence: "combined" })],
        window,
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendation.actionType).toBe("increase_visual_pacing")
    })

    // A gain is not a problem to diagnose, so it keeps its own answer whatever
    // the moment was about.
    it("still tells a gain to repeat what worked", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "topic_shift", primaryEvidence: "transcript" })],
        window: { ...window, kind: "gain" },
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendation.actionType).toBe("preserve_pattern")
    })

    // Nor is a hold. Answered from the subject and the measurements, a stretch
    // that kept every viewer it had came back advised to cut its silence or add
    // a graphic to it.
    it("tells a hold to build more of the next video the same way", () => {
      const [recommendation] = compileDeepAnalysisRecommendations({
        events: [event({ eventType: "audio_change", primaryEvidence: "audio" })],
        window: { ...window, kind: "hold" },
        editing: { freezeCoverage: 0.2 } as never,
        baseline: { cutsPerMinute: 8, speechRate: 150 },
        audio: { silence: 0.2 } as never,
      })
      expect(recommendation.actionType).toBe("sustain_attention")
    })

    // A gain is a beat to stage again; a hold is a span to build more of. Both
    // are successes, and a report carrying one of each has to have something
    // different to say about them or the uniqueness pass silences the second.
    it("gives a hold different advice from a gain", () => {
      const [gain] = compileDeepAnalysisRecommendations({
        events: [event()],
        window: { ...window, kind: "gain" },
        audio: null,
        ...slowlyCutWindow,
      })
      const [hold] = compileDeepAnalysisRecommendations({
        events: [event({ id: "event-2" })],
        window: { ...window, id: "window-2", kind: "hold" },
        audio: null,
        ...slowlyCutWindow,
      })
      expect(isNearDuplicateAdvice(gain.action, hold.action)).toBe(false)
    })

    // The two halves of the fix meet here: insights about different things no
    // longer collapse onto one branch, so a window's own tabs stop competing
    // for the same advice before the uniqueness pass has to intervene.
    it("gives two insights about different things two kinds of advice", () => {
      const recommendations = compileDeepAnalysisRecommendations({
        events: [
          event({ id: "event-1", eventType: "topic_shift", primaryEvidence: "transcript" }),
          event({ id: "event-2", eventType: "visual_change", primaryEvidence: "visual" }),
        ],
        window,
        audio: null,
        ...slowlyCutWindow,
      })
      expect(recommendations.map((entry) => entry.actionType)).toEqual([
        "signpost_topic_shift",
        "add_visual_support",
      ])
    })
  })

  // One case per branch of the generator. The rules below hold for every
  // wording a branch can produce, not only the one it prefers, so each test
  // walks the alternatives too.
  const BRANCH_CASES: Parameters<typeof compileDeepAnalysisRecommendations>[0][] = [
    { events: [event()], window, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
    { events: [event()], window: { ...window, kind: "gain" }, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
    { events: [event()], window: { ...window, kind: "hold" }, editing: null, baseline: { cutsPerMinute: null, speechRate: null }, audio: null },
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

  // Every wording a branch can offer, preferred first, as the pairs of copy the
  // uniqueness pass chooses between.
  function everyWording(params: Parameters<typeof compileDeepAnalysisRecommendations>[0]) {
    const [recommendation] = compileDeepAnalysisRecommendations(params)
    return {
      actionType: recommendation.actionType,
      copy: [
        { action: recommendation.action, expectedPurpose: recommendation.expectedPurpose },
        ...(recommendation.alternativeCopy ?? []),
      ],
    }
  }

  // The video being analysed is already live on YouTube, so no recommendation may
  // ask the uploader to change it or to race an alternate cut against the current
  // one. Every branch has to read as advice for the videos they make next.
  it("never asks the uploader to re-edit the published video", () => {
    const seen = new Set<string>()
    for (const params of BRANCH_CASES) {
      const { actionType, copy } = everyWording(params)
      seen.add(actionType)
      for (const { action, expectedPurpose } of copy) {
        expect(`${action} ${expectedPurpose}`).not.toMatch(
          /alternate cut|current edit|this edit|re-?edit|re-?cut|re-?upload|against the current/i,
        )
      }
    }

    // Guards the loop itself: if a new branch is added without a case here, the
    // count stops matching and this test asks for the missing coverage.
    expect(seen.size).toBe(11)
  })

  // The tip is already labelled as advice for the next video, so a "next time"
  // lead-in only pushes the action further down the sentence, and reads as a
  // tic once every tip on the page opens the same way. Each action starts on
  // the thing to do.
  it("never opens an action with a forward-looking preamble", () => {
    for (const params of BRANCH_CASES) {
      for (const { action } of everyWording(params).copy) {
        expect(action).not.toMatch(
          /^(next time|next video|in (your |the )?(next|future)|for (your |the )?(next|future)|going forward|from now on)/i,
        )
      }
    }
  })

  // A branch's alternatives exist so a second window measuring the same thing
  // has something else to say. A rephrasing of the wording above it would be
  // rejected by the uniqueness pass and the window would silently lose its tip,
  // so each has to be a different action.
  it("offers alternatives that are different advice, not rewordings", () => {
    for (const params of BRANCH_CASES) {
      const { actionType, copy } = everyWording(params)
      expect(copy.length, `${actionType} needs a wording to fall back on`).toBeGreaterThan(1)
      for (const [index, { action }] of copy.entries()) {
        for (const earlier of copy.slice(0, index)) {
          expect(
            isNearDuplicateAdvice(earlier.action, action),
            `${actionType} says the same thing twice: "${earlier.action}" / "${action}"`,
          ).toBe(false)
        }
      }
      // The subtext under a tip belongs to that tip, so it moves with it and is
      // as distinct as the tip is.
      expect(new Set(copy.map((option) => option.expectedPurpose)).size).toBe(
        copy.length,
      )
    }
  })

  // Windows far apart in the video that measure the same thing: the lesson is
  // real in each of them, but three rows printing one sentence read as a
  // template. This is the case from the report that prompted the change: three
  // talking stretches with no cuts, minutes apart, all landing on
  // increase_visual_pacing.
  function slowlyCutWindow(id: string, timestampSeconds: number, insightScore: number) {
    return compileDeepAnalysisRecommendations({
      events: [event({ id: `event-${id}`, timestampSeconds, insightScore })],
      window: { ...window, id },
      editing: { cutsPerMinute: 0 } as never,
      baseline: { cutsPerMinute: 0.75, speechRate: null },
      audio: null,
    })
  }

  it("gives every window measuring the same thing something different to say", () => {
    const groups = [
      slowlyCutWindow("window-1", 40, 0.9),
      slowlyCutWindow("window-2", 189, 0.8),
      slowlyCutWindow("window-3", 338, 0.7),
    ]
    dedupeDeepAnalysisRecommendations(groups)

    const actions = groups.flat().map((recommendation) => recommendation.action)
    expect(actions).toHaveLength(3)
    expect(new Set(actions).size).toBe(3)
    for (const [index, action] of actions.entries()) {
      for (const earlier of actions.slice(0, index)) {
        expect(isNearDuplicateAdvice(earlier, action)).toBe(false)
      }
    }
    // The strongest insight keeps the wording the branch leads with.
    expect(groups[0][0].action).toContain("one thing for people to look at")
  })

  it("drops a repeat once the branch has nothing new left to say", () => {
    // One more window than the branch has wordings for.
    const groups = [
      slowlyCutWindow("window-1", 40, 0.9),
      slowlyCutWindow("window-2", 189, 0.8),
      slowlyCutWindow("window-3", 338, 0.7),
      slowlyCutWindow("window-4", 487, 0.6),
      slowlyCutWindow("window-5", 636, 0.5),
    ]
    dedupeDeepAnalysisRecommendations(groups)

    const actions = groups.flat().map((recommendation) => recommendation.action)
    expect(actions.length).toBeLessThan(5)
    expect(new Set(actions).size).toBe(actions.length)
    // The window that ran out shows its evidence with no tip under it, rather
    // than a tip the reader has already read.
    expect(groups[4]).toHaveLength(0)
  })

  // Working state for the pass above, and a needless payload on every rendered
  // recommendation once it has run.
  it("leaves no unused wordings on a kept recommendation", () => {
    const groups = [slowlyCutWindow("window-1", 40, 0.9)]
    expect(groups[0][0].alternativeCopy?.length).toBeGreaterThan(0)
    dedupeDeepAnalysisRecommendations(groups)
    expect(groups[0][0]).not.toHaveProperty("alternativeCopy")
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
