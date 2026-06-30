import { describe, expect, it } from "vitest"

import {
  cleanTranscriptCues,
  replaceCaptionBleeps,
  type TranscriptCue,
} from "@/lib/youtube/youtube"

// The non-breaking space (U+00A0) YouTube pads its bleep markers with. Using
// the real character here is what makes these tests exercise the actual input.
const NBSP = " "

describe("replaceCaptionBleeps", () => {
  it("replaces a bleep marker padded with non-breaking spaces", () => {
    const input = `lost a [${NBSP}__${NBSP}] ton of money`
    expect(replaceCaptionBleeps(input)).toBe("lost a **** ton of money")
  })

  it("replaces a bleep marker padded with normal spaces", () => {
    expect(replaceCaptionBleeps("what a [ __ ] mess")).toBe(
      "what a **** mess",
    )
  })

  it("replaces a marker padded with literal &nbsp; entities", () => {
    expect(replaceCaptionBleeps("what a [&nbsp;__&nbsp;] mess")).toBe(
      "what a **** mess",
    )
    expect(replaceCaptionBleeps("[&nbsp;__&nbsp;]")).toBe("****")
  })

  it("handles markers with no padding and varying underscore counts", () => {
    expect(replaceCaptionBleeps("oh [__] no")).toBe("oh **** no")
    expect(replaceCaptionBleeps("oh [____] no")).toBe("oh **** no")
  })

  it("replaces a marker at the start or end of the text", () => {
    expect(replaceCaptionBleeps(`[${NBSP}__${NBSP}] hello`)).toBe(
      "**** hello",
    )
    expect(replaceCaptionBleeps(`hello [${NBSP}__${NBSP}]`)).toBe(
      "hello ****",
    )
  })

  it("leaves genuine bracketed annotations untouched", () => {
    expect(replaceCaptionBleeps("[Music] the beat drops")).toBe(
      "[Music] the beat drops",
    )
    expect(replaceCaptionBleeps("clap [Applause] clap")).toBe(
      "clap [Applause] clap",
    )
  })

  it("preserves a cue that is only a bleep as a profanity placeholder", () => {
    expect(replaceCaptionBleeps(`[${NBSP}__${NBSP}]`)).toBe("****")
  })
})

describe("cleanTranscriptCues", () => {
  it("replaces bleeps in cue text", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 2, text: `we lost a [${NBSP}__${NBSP}] ton` },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 2, text: "we lost a **** ton" },
    ])
  })

  it("keeps a cue that is nothing but a bleep marker", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 1, text: "hello" },
      { startSeconds: 1, endSeconds: 2, text: `[${NBSP}__${NBSP}]` },
      { startSeconds: 2, endSeconds: 3, text: "world" },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 1, text: "hello" },
      { startSeconds: 1, endSeconds: 2, text: "****" },
      { startSeconds: 2, endSeconds: 3, text: "world" },
    ])
  })

  it("still collapses rolling-window duplication after replacement", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 2, text: `a [${NBSP}__${NBSP}] ton of money` },
      { startSeconds: 2, endSeconds: 4, text: "ton of money we lost" },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 2, text: "a **** ton of money" },
      { startSeconds: 2, endSeconds: 4, text: "we lost" },
    ])
  })
})
