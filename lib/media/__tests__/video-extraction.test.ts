import { describe, expect, it } from "vitest"

import {
  buildAudioSegmentArgs,
  buildAudioStatsArgs,
  buildThumbnailArgs,
  parseAudioSignalStats,
} from "@/lib/media/video-extraction"

describe("buildThumbnailArgs", () => {
  it("seeks the input before -i and grabs a single JPEG frame", () => {
    expect(buildThumbnailArgs("https://signed.example/video.mp4", 12.5)).toEqual([
      "-ss",
      "12.5",
      "-i",
      "https://signed.example/video.mp4",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ])
  })

  it("clamps a negative timestamp to 0", () => {
    expect(buildThumbnailArgs("https://s.example/v.mp4", -3)).toContain("0")
    expect(buildThumbnailArgs("https://s.example/v.mp4", -3)[1]).toBe("0")
  })
})

describe("buildAudioSegmentArgs", () => {
  it("seeks to fromSeconds and requests the span's duration", () => {
    expect(
      buildAudioSegmentArgs("https://signed.example/video.mp4", 20, 60),
    ).toEqual([
      "-ss",
      "20",
      "-i",
      "https://signed.example/video.mp4",
      "-t",
      "40",
      "-vn",
      "-acodec",
      "aac",
      "-b:a",
      "128k",
      "-f",
      "adts",
      "pipe:1",
    ])
  })

  it("clamps a negative duration to 0 rather than going negative", () => {
    const args = buildAudioSegmentArgs("https://s.example/v.mp4", 10, 5)
    expect(args[args.indexOf("-t") + 1]).toBe("0")
  })
})

describe("buildAudioStatsArgs", () => {
  it("runs volumedetect and silencedetect against the clip with no output file", () => {
    expect(buildAudioStatsArgs("https://signed.example/audio.aac")).toEqual([
      "-i",
      "https://signed.example/audio.aac",
      "-af",
      "silencedetect=noise=-35dB:d=0.3,volumedetect",
      "-f",
      "null",
      "-",
    ])
  })
})

describe("parseAudioSignalStats", () => {
  it("reads mean_volume and sums every silence_duration into a ratio", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 0.3",
      "[silencedetect @ 0x1] silence_end: 1.3 | silence_duration: 1.0",
      "[silencedetect @ 0x1] silence_start: 5.0",
      "[silencedetect @ 0x1] silence_end: 6.5 | silence_duration: 1.5",
      "[Parsed_volumedetect_1 @ 0x2] mean_volume: -19.2 dB",
      "[Parsed_volumedetect_1 @ 0x2] max_volume: -3.0 dB",
    ].join("\n")

    expect(parseAudioSignalStats(stderr, 10)).toEqual({
      averageVolumeDb: -19.2,
      silenceRatio: 0.25,
    })
  })

  it("clamps a silence ratio that would exceed 1 (overlapping/rounding noise)", () => {
    const stderr = "[silencedetect @ 0x1] silence_duration: 45"
    expect(parseAudioSignalStats(stderr, 30).silenceRatio).toBe(1)
  })

  it("finds no volume and no silence when the expected log lines are missing", () => {
    expect(parseAudioSignalStats("no useful output", 30)).toEqual({
      averageVolumeDb: null,
      silenceRatio: 0,
    })
  })

  it("returns a null silence ratio when duration is unknown", () => {
    expect(parseAudioSignalStats("mean_volume: -10 dB", 0).silenceRatio).toBeNull()
  })
})
