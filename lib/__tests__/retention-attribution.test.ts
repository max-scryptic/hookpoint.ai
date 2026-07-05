import { describe, expect, it } from "vitest"

import { prepareRetentionMoments } from "@/lib/retention-attribution"
import type { RetentionWindow } from "@/lib/retention-windows"
import type { TranscriptCue } from "@/lib/youtube/youtube"

function window(overrides: Partial<RetentionWindow>): RetentionWindow {
  return {
    kind: "drop_off",
    windowIndex: 0,
    windowKey: null,
    label: null,
    fromSeconds: 0,
    toSeconds: 0,
    startWatchRatio: null,
    endWatchRatio: null,
    delta: 0,
    relativePerformance: null,
    steepness: null,
    isAbnormallySteep: null,
    outOfRange: false,
    analysisFromSeconds: null,
    analysisToSeconds: null,
    ...overrides,
  }
}

const transcript: TranscriptCue[] = [
  { startSeconds: 40, endSeconds: 50, text: "here comes the sponsor read" },
  { startSeconds: 120, endSeconds: 130, text: "the surprising payoff lands" },
]

describe("prepareRetentionMoments", () => {
  it("orders drop-offs before gains and pulls transcript from the analysis window", () => {
    const windows: RetentionWindow[] = [
      window({
        kind: "gain",
        windowIndex: 0,
        fromSeconds: 122,
        toSeconds: 124,
        delta: 0.05,
        analysisFromSeconds: 118,
        analysisToSeconds: 132,
      }),
      window({
        kind: "drop_off",
        windowIndex: 0,
        fromSeconds: 45,
        toSeconds: 47,
        delta: -0.08,
        analysisFromSeconds: 38,
        analysisToSeconds: 52,
      }),
    ]

    const moments = prepareRetentionMoments(windows, transcript)

    expect(moments.map((moment) => moment.kind)).toEqual(["drop_off", "gain"])
    expect(moments[0].said).toContain("sponsor read")
    expect(moments[0].deltaPercent).toBe(-8)
    expect(moments[1].said).toContain("payoff")
  })

  it("skips out-of-range windows", () => {
    const windows: RetentionWindow[] = [
      window({ kind: "drop_off", windowIndex: 0, outOfRange: true }),
    ]
    expect(prepareRetentionMoments(windows, transcript)).toEqual([])
  })
})
