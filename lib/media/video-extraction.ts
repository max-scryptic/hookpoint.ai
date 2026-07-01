// Grabs a single frame or an audio segment from a video served over HTTPS. `-ss`
// placed before `-i` seeks the input directly (nearest keyframe at/after the
// timestamp) rather than decoding everything before it, which is what makes
// this fast enough to run against a remote signed URL instead of a local file.

import { runFfmpeg, runFfmpegCapturingOutput } from "@/lib/media/ffmpeg"

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

export interface AudioSignalStats {
  // Mean loudness in dB, as ffmpeg's volumedetect filter measures it (0 is
  // maximum digital amplitude, so this is always <= 0). Null if the filter's
  // output couldn't be parsed.
  averageVolumeDb: number | null
  // Fraction of the clip (0-1) that silencedetect classified as silence. Null
  // if the clip's duration is unknown.
  silenceRatio: number | null
}

// These are deterministic acoustic measurements, not something worth asking a
// model to estimate by ear (an LLM "listening" to a clip has no way to
// actually measure dB or silence duration — it would just be fabricating a
// plausible-sounding number). ffmpeg's own filters give exact values for the
// price of one extra decode pass.
export function buildAudioStatsArgs(sourceUrl: string): string[] {
  return [
    "-i",
    sourceUrl,
    "-af",
    "silencedetect=noise=-35dB:d=0.3,volumedetect",
    "-f",
    "null",
    "-",
  ]
}

// Parses the log lines volumedetect/silencedetect write to stderr, e.g.:
//   [Parsed_volumedetect_1 @ ...] mean_volume: -19.2 dB
//   [silencedetect @ ...] silence_end: 1.2 | silence_duration: 0.92
// `durationSeconds` comes from the caller (the known clip length) rather than
// ffmpeg's own "Duration:" line, since that line isn't always present for a
// piped/streamed input.
export function parseAudioSignalStats(
  stderr: string,
  durationSeconds: number,
): AudioSignalStats {
  const meanVolumeMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
  const averageVolumeDb = meanVolumeMatch ? Number(meanVolumeMatch[1]) : null

  const silenceDurations = [
    ...stderr.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g),
  ].map((match) => Number(match[1]))
  const totalSilenceSeconds = silenceDurations.reduce(
    (sum, value) => sum + value,
    0,
  )
  const silenceRatio =
    durationSeconds > 0
      ? Math.min(1, Math.max(0, totalSilenceSeconds / durationSeconds))
      : null

  return { averageVolumeDb, silenceRatio }
}

// Measures loudness and silence ratio for an already-extracted audio clip
// (not the source video — this runs against the harvested per-window .aac
// file). Best-effort: callers should treat a rejection the same as "stats
// unavailable" rather than failing the whole analysis.
export async function measureAudioClipStats(
  sourceUrl: string,
  durationSeconds: number,
): Promise<AudioSignalStats> {
  const { stderr } = await runFfmpegCapturingOutput(
    buildAudioStatsArgs(sourceUrl),
  )
  return parseAudioSignalStats(stderr, durationSeconds)
}
