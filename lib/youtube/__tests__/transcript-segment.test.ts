import { describe, expect, it } from "vitest"

import {
  transcriptForSegment,
  transcriptSegmentEdges,
  type TranscriptCue,
} from "@/lib/youtube/youtube"

function cue(
  startSeconds: number,
  endSeconds: number,
  text: string,
): TranscriptCue {
  return { startSeconds, endSeconds, text }
}

const cues: TranscriptCue[] = [
  cue(0, 4, "What is up crypto gang"),
  cue(5, 9, "it's been a very long time"),
  cue(10, 14, "so let's get into it"),
  cue(15, 19, "and that's all for today"),
]

describe("transcriptForSegment", () => {
  it("joins the cues overlapping the window", () => {
    expect(transcriptForSegment(cues, 0, 9)).toBe(
      "What is up crypto gang it's been a very long time",
    )
  })
})

describe("transcriptSegmentEdges", () => {
  it("marks a window at the very start as touching the start only", () => {
    expect(transcriptSegmentEdges(cues, 0, 9)).toEqual({
      atStart: true,
      atEnd: false,
    })
  })

  it("marks a window at the very end as touching the end only", () => {
    expect(transcriptSegmentEdges(cues, 15, 19)).toEqual({
      atStart: false,
      atEnd: true,
    })
  })

  it("marks a mid-script window as touching neither edge", () => {
    expect(transcriptSegmentEdges(cues, 10, 14)).toEqual({
      atStart: false,
      atEnd: false,
    })
  })

  it("marks a window spanning the whole script as touching both edges", () => {
    expect(transcriptSegmentEdges(cues, 0, 19)).toEqual({
      atStart: true,
      atEnd: true,
    })
  })

  it("reports no edges when the window contains no cues", () => {
    expect(transcriptSegmentEdges(cues, 100, 120)).toEqual({
      atStart: false,
      atEnd: false,
    })
  })
})
