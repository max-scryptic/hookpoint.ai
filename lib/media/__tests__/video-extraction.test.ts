import { describe, expect, it } from "vitest"

import {
  buildAudioSegmentArgs,
  buildThumbnailArgs,
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
