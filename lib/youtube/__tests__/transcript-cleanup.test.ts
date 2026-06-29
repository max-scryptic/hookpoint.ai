import { describe, expect, it } from "vitest"

import {
  cleanTranscriptCues,
  stripUnreadableBracketedText,
  type TranscriptCue,
} from "@/lib/youtube/youtube"

// The non-breaking space (U+00A0) YouTube pads its bleep markers with. Using
// the real character here is what makes these tests exercise the actual input.
const NBSP = " "

describe("stripUnreadableBracketedText", () => {
  it("removes a bleep marker padded with non-breaking spaces", () => {
    const input = `lost a [${NBSP}__${NBSP}] ton of money`
    expect(stripUnreadableBracketedText(input)).toBe("lost a ton of money")
  })

  it("removes a bleep marker padded with normal spaces", () => {
    expect(stripUnreadableBracketedText("what a [ __ ] mess")).toBe(
      "what a mess",
    )
  })

  it("removes a bleep marker containing literal HTML entities", () => {
    expect(stripCaptionBleeps("what a [&nbsp;__&nbsp;] mess")).toBe(
      "what a mess",
    )
  })

  it("handles markers with no padding and varying underscore counts", () => {
    expect(stripUnreadableBracketedText("oh [__] no")).toBe("oh no")
    expect(stripUnreadableBracketedText("oh [____] no")).toBe("oh no")
  })

  it("removes other unreadable bracketed artifacts", () => {
    expect(stripUnreadableBracketedText("wait [...] what [???]")).toBe(
      "wait what",
    )
    expect(stripUnreadableBracketedText("intro [♪♪] welcome [---]")).toBe(
      "intro welcome",
    )
  })

  it("strips a marker at the start or end of the text", () => {
    expect(stripUnreadableBracketedText(`[${NBSP}__${NBSP}] hello`)).toBe(
      "hello",
    )
    expect(stripUnreadableBracketedText(`hello [${NBSP}__${NBSP}]`)).toBe(
      "hello",
    )
  })

  it("leaves readable bracketed annotations untouched", () => {
    expect(stripUnreadableBracketedText("[Music] the beat drops")).toBe(
      "[Music] the beat drops",
    )
    expect(stripUnreadableBracketedText("[Noise] clap [Applause] clap")).toBe(
      "[Noise] clap [Applause] clap",
    )
    expect(stripUnreadableBracketedText("你好 [音乐] world")).toBe(
      "你好 [音乐] world",
    )
    expect(stripUnreadableBracketedText("count [3] clap")).toBe(
      "count [3] clap",
    )
  })

  it("returns an empty string for a cue that is only a bleep", () => {
    expect(stripUnreadableBracketedText(`[${NBSP}__${NBSP}]`)).toBe("")
  })
})

describe("cleanTranscriptCues", () => {
  it("strips bleeps from cue text", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 2, text: `we lost a [${NBSP}__${NBSP}] ton` },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 2, text: "we lost a ton" },
    ])
  })

  it("drops a cue that is nothing but a bleep marker", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 1, text: "hello" },
      { startSeconds: 1, endSeconds: 2, text: `[${NBSP}__${NBSP}]` },
      { startSeconds: 2, endSeconds: 3, text: "world" },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 1, text: "hello" },
      { startSeconds: 2, endSeconds: 3, text: "world" },
    ])
  })

  it("still collapses rolling-window duplication after stripping", () => {
    const cues: TranscriptCue[] = [
      { startSeconds: 0, endSeconds: 2, text: `a [${NBSP}__${NBSP}] ton of money` },
      { startSeconds: 2, endSeconds: 4, text: "ton of money we lost" },
    ]
    expect(cleanTranscriptCues(cues)).toEqual([
      { startSeconds: 0, endSeconds: 2, text: "a ton of money" },
      { startSeconds: 2, endSeconds: 4, text: "we lost" },
    ])
  })
})
