import { describe, expect, it } from "vitest"

import {
  buildAudioSegmentArgs,
  buildAudioSignalBucketsArgs,
  buildAudioStatsArgs,
  buildThumbnailArgs,
  parseAudioSignalBuckets,
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
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
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
    expect(buildAudioStatsArgs("https://signed.example/audio.mp3")).toEqual([
      "-i",
      "https://signed.example/audio.mp3",
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

describe("timestamped audio signal buckets", () => {
  it("builds one-pass five-second RMS and silence analysis", () => {
    const args = buildAudioSignalBucketsArgs("https://example.test/audio.mp3")
    const filter = args[args.indexOf("-af") + 1]
    expect(filter).toContain("aresample=16000")
    expect(filter).toContain("asetnsamples=n=80000:p=0")
    expect(filter).toContain("silencedetect=noise=-35dB:d=0.3")
    expect(filter).toContain("lavfi.astats.Overall.RMS_level")
  })

  it("parses loudness and intersects silence spans with each bucket", () => {
    const stderr = [
      "frame:0 pts:0 pts_time:0",
      "lavfi.astats.Overall.RMS_level=-18.5",
      "[silencedetect @ 0x1] silence_start: 3",
      "[silencedetect @ 0x1] silence_end: 7 | silence_duration: 4",
      "frame:1 pts:80000 pts_time:5",
      "lavfi.astats.Overall.RMS_level=-24",
    ].join("\n")

    expect(parseAudioSignalBuckets(stderr, 10)).toEqual([
      {
        fromSeconds: 0,
        toSeconds: 5,
        averageVolumeDb: -18.5,
        silenceRatio: 0.4,
      },
      {
        fromSeconds: 5,
        toSeconds: 10,
        averageVolumeDb: -24,
        silenceRatio: 0.4,
      },
    ])
  })

  it("closes an ongoing silence at the clip end", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 2",
      "frame:0 pts:0 pts_time:0",
      "lavfi.astats.Overall.RMS_level=-inf",
    ].join("\n")

    expect(parseAudioSignalBuckets(stderr, 5)[0].silenceRatio).toBeCloseTo(0.6)
  })
})
