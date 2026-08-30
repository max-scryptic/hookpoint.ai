import { afterEach, describe, expect, it } from "vitest"

import { parseMediaDuration } from "@/lib/media/video-extraction"
import { transcriptionCostUsd } from "@/lib/transcription-cost"
import { offsetCues, planTranscriptChunks } from "@/lib/video-plans/transcript"

describe("planTranscriptChunks", () => {
  it("covers a video shorter than one chunk in a single request", () => {
    expect(planTranscriptChunks(400, 600)).toEqual([
      { fromSeconds: 0, toSeconds: 400 },
    ])
  })

  it("splits a longer video and stops exactly at the end", () => {
    expect(planTranscriptChunks(1500, 600)).toEqual([
      { fromSeconds: 0, toSeconds: 600 },
      { fromSeconds: 600, toSeconds: 1200 },
      { fromSeconds: 1200, toSeconds: 1500 },
    ])
  })

  it("makes no extra empty chunk when the duration divides exactly", () => {
    expect(planTranscriptChunks(1200, 600)).toEqual([
      { fromSeconds: 0, toSeconds: 600 },
      { fromSeconds: 600, toSeconds: 1200 },
    ])
  })

  it("transcribes nothing for a duration it cannot use", () => {
    expect(planTranscriptChunks(0, 600)).toEqual([])
    expect(planTranscriptChunks(-5, 600)).toEqual([])
    expect(planTranscriptChunks(Number.NaN, 600)).toEqual([])
  })

  it("stops at the four-hour backstop rather than running away", () => {
    const chunks = planTranscriptChunks(10 * 60 * 60, 600)
    expect(chunks.at(-1)?.toSeconds).toBe(4 * 60 * 60)
  })
})

describe("offsetCues", () => {
  it("shifts a later chunk's cues into whole-video time", () => {
    expect(
      offsetCues([{ start: 2, end: 5, text: " hello there " }], 600),
    ).toEqual([{ startSeconds: 602, endSeconds: 605, text: "hello there" }])
  })

  it("leaves the first chunk where it is", () => {
    expect(offsetCues([{ start: 0, end: 3, text: "opening" }], 0)).toEqual([
      { startSeconds: 0, endSeconds: 3, text: "opening" },
    ])
  })

  it("drops cues with nothing said in them", () => {
    expect(
      offsetCues(
        [
          { start: 0, end: 1, text: "   " },
          { start: 1, end: 2, text: "real" },
        ],
        0,
      ),
    ).toEqual([{ startSeconds: 1, endSeconds: 2, text: "real" }])
  })
})

describe("parseMediaDuration", () => {
  it("reads the duration ffmpeg prints while opening the input", () => {
    expect(
      parseMediaDuration(
        "  Duration: 00:12:34.56, start: 0.000000, bitrate: 1234 kb/s",
      ),
    ).toBeCloseTo(754.56)
  })

  it("handles an hours-long source", () => {
    expect(parseMediaDuration("Duration: 02:00:00.00, start: 0")).toBe(7200)
  })

  it("copes with no fractional part", () => {
    expect(parseMediaDuration("Duration: 00:00:30, start: 0")).toBe(30)
  })

  it("returns null when ffmpeg reported no usable duration", () => {
    expect(parseMediaDuration("Duration: N/A, bitrate: N/A")).toBeNull()
    expect(parseMediaDuration("Duration: 00:00:00.00, start: 0")).toBeNull()
    expect(parseMediaDuration("no duration line here")).toBeNull()
  })
})

describe("transcriptionCostUsd", () => {
  afterEach(() => {
    delete process.env.OPENAI_TRANSCRIPTION_USD_PER_MINUTE
  })

  it("prices whisper-1 at its published per-minute rate", () => {
    // Twenty minutes at $0.006/min.
    expect(transcriptionCostUsd(20 * 60, "whisper-1")).toBeCloseTo(0.12)
  })

  it("prices a cheaper model lower", () => {
    expect(transcriptionCostUsd(20 * 60, "gpt-4o-mini-transcribe")).toBeCloseTo(
      0.06,
    )
  })

  it("never records an unknown model as free", () => {
    expect(transcriptionCostUsd(60, "some-new-model")).toBeGreaterThan(0)
  })

  it("invents no cost for a duration it does not have", () => {
    expect(transcriptionCostUsd(null, "whisper-1")).toBe(0)
    expect(transcriptionCostUsd(0, "whisper-1")).toBe(0)
    expect(transcriptionCostUsd(-10, "whisper-1")).toBe(0)
  })

  it("honours a runtime rate override", () => {
    process.env.OPENAI_TRANSCRIPTION_USD_PER_MINUTE = "0.01"
    expect(transcriptionCostUsd(60, "whisper-1")).toBeCloseTo(0.01)
  })
})
