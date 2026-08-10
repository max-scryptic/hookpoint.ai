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
  {
    startSeconds: 0,
    endSeconds: 10,
    text: "today I am going to show you the one setting that fixes this for good",
  },
  {
    startSeconds: 40,
    endSeconds: 50,
    text: "but before we get into it, a quick word from the sponsor of this video",
  },
  {
    startSeconds: 120,
    endSeconds: 130,
    text: "and here is the payoff everybody keeps asking me about in the comments",
  },
]

describe("prepareRetentionMoments", () => {
  it("orders hooks, drop-offs, then gains and pulls transcript from the analysis window", () => {
    const windows: RetentionWindow[] = [
      window({
        kind: "hook",
        windowIndex: 0,
        fromSeconds: 0,
        toSeconds: 10,
        delta: -0.12,
      }),
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

    expect(moments.map((moment) => moment.kind)).toEqual([
      "hook",
      "drop_off",
      "gain",
    ])
    expect(moments[0].said).toContain("one setting")
    expect(moments[1].said).toContain("sponsor")
    expect(moments[1].deltaPercent).toBe(-8)
    expect(moments[2].said).toContain("payoff")
  })

  it("skips out-of-range windows", () => {
    const windows: RetentionWindow[] = [
      window({ kind: "drop_off", windowIndex: 0, outOfRange: true }),
    ]
    expect(prepareRetentionMoments(windows, transcript)).toEqual([])
  })

  // Asked about a moment it was given no words for, the model still has to
  // return an explanation and a tip, so both are invented. The window keeps its
  // retention figures and whatever deep analysis found there; it just gets no
  // script feedback.
  it("leaves out a window with no transcript over it", () => {
    const windows: RetentionWindow[] = [
      window({ kind: "drop_off", windowIndex: 0, fromSeconds: 300, toSeconds: 310 }),
    ]
    expect(prepareRetentionMoments(windows, transcript)).toEqual([])
  })

  it("leaves out a window carrying too few words to reason from", () => {
    const windows: RetentionWindow[] = [
      window({ kind: "drop_off", windowIndex: 0, fromSeconds: 200, toSeconds: 210 }),
    ]
    const thin: TranscriptCue[] = [
      { startSeconds: 200, endSeconds: 210, text: "so yeah, anyway" },
    ]
    expect(prepareRetentionMoments(windows, thin)).toEqual([])
  })

  it("keeps a window whose transcript is thin but says something", () => {
    const windows: RetentionWindow[] = [
      window({ kind: "drop_off", windowIndex: 0, fromSeconds: 200, toSeconds: 210 }),
    ]
    const enough: TranscriptCue[] = [
      {
        startSeconds: 200,
        endSeconds: 210,
        text: "anyway that is enough about that, let us move on",
      },
    ]
    expect(prepareRetentionMoments(windows, enough)).toHaveLength(1)
  })

  // The words either side of a drop still count towards the threshold: a moment
  // detected over two seconds of silence is reasoned about over the padded
  // window that carries its lead-in.
  it("counts the words over the padded analysis window, not the detected step", () => {
    const windows: RetentionWindow[] = [
      window({
        kind: "drop_off",
        windowIndex: 0,
        fromSeconds: 55,
        toSeconds: 57,
        analysisFromSeconds: 38,
        analysisToSeconds: 60,
      }),
    ]
    expect(prepareRetentionMoments(windows, transcript)).toHaveLength(1)
  })
})
