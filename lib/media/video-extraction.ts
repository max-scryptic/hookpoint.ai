// Grabs a single frame or an audio segment from a video served over HTTPS. `-ss`
// placed before `-i` seeks the input directly (nearest keyframe at/after the
// timestamp) rather than decoding everything before it, which is what makes
// this fast enough to run against a remote signed URL instead of a local file.

import { runFfmpeg } from "@/lib/media/ffmpeg"

export interface VideoExtractor {
  extractThumbnail(sourceUrl: string, atSeconds: number): Promise<Buffer>
  extractAudioSegment(
    sourceUrl: string,
    fromSeconds: number,
    toSeconds: number,
  ): Promise<Buffer>
}

// Pure arg builders, split out from the actual subprocess call so the exact
// ffmpeg invocation is unit-testable without spawning a real process.

export function buildThumbnailArgs(
  sourceUrl: string,
  atSeconds: number,
): string[] {
  return [
    "-ss",
    String(Math.max(0, atSeconds)),
    "-i",
    sourceUrl,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ]
}

export function buildAudioSegmentArgs(
  sourceUrl: string,
  fromSeconds: number,
  toSeconds: number,
): string[] {
  const duration = Math.max(0, toSeconds - fromSeconds)
  return [
    "-ss",
    String(Math.max(0, fromSeconds)),
    "-i",
    sourceUrl,
    "-t",
    String(duration),
    "-vn",
    "-acodec",
    "aac",
    "-b:a",
    "128k",
    "-f",
    "adts",
    "pipe:1",
  ]
}

// Extracts a single JPEG frame at `atSeconds`.
export async function extractThumbnail(
  sourceUrl: string,
  atSeconds: number,
): Promise<Buffer> {
  return runFfmpeg(buildThumbnailArgs(sourceUrl, atSeconds))
}

// Extracts the audio track for [fromSeconds, toSeconds] as AAC.
export async function extractAudioSegment(
  sourceUrl: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<Buffer> {
  return runFfmpeg(buildAudioSegmentArgs(sourceUrl, fromSeconds, toSeconds))
}

export const defaultVideoExtractor: VideoExtractor = {
  extractThumbnail,
  extractAudioSegment,
}
