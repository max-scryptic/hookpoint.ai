// Pure validation logic for matching an uploaded raw video file to the YouTube
// video it claims to be the source of. Everything here is side-effect free and
// dependency free so it can be unit-tested directly and reused from the route
// handlers, the validation service and a future background worker.

export type DurationValidationStatus = "passed" | "failed"
export type FilenameValidationStatus = "passed" | "warning" | "unknown"
export type OverallValidationStatus = "pending" | "passed" | "warning" | "failed"

export interface DurationComparison {
  uploadedDurationSeconds: number
  youtubeDurationSeconds: number
  differenceSeconds: number
  status: DurationValidationStatus
}

// Compares the uploaded file's duration against the YouTube-reported duration.
// Within `toleranceSeconds` (inclusive) passes; anything further apart fails.
export function compareDuration(
  uploadedDurationSeconds: number,
  youtubeDurationSeconds: number,
  toleranceSeconds: number,
): DurationComparison {
  const differenceSeconds =
    Math.round(Math.abs(uploadedDurationSeconds - youtubeDurationSeconds) * 1000) /
    1000
  return {
    uploadedDurationSeconds,
    youtubeDurationSeconds,
    differenceSeconds,
    status: differenceSeconds <= toleranceSeconds ? "passed" : "failed",
  }
}

// Words that commonly decorate export filenames but carry no signal about which
// video it is. Stripped before comparison so "my-video-final-v2.mp4" still
// matches the title "My Video".
const FILLER_WORDS = new Set([
  "final",
  "finalcut",
  "export",
  "exported",
  "edit",
  "edited",
  "v1",
  "v2",
  "v3",
  "v4",
  "youtube",
  "yt",
  "draft",
  "render",
  "rendered",
  "master",
  "copy",
  "fullhd",
  "hd",
  "1080p",
  "4k",
  "2160p",
  "60fps",
])

// Normalises a string into a set of comparison tokens: lowercased, extension
// removed (for filenames), punctuation and separators turned into spaces,
// filler words dropped, single chars dropped.
export function normaliseForComparison(
  value: string,
  { stripExtension = false }: { stripExtension?: boolean } = {},
): string[] {
  let s = value.toLowerCase().trim()

  if (stripExtension) {
    const dot = s.lastIndexOf(".")
    // Only treat a trailing 1-5 char run as an extension, so titles containing
    // dots ("v2.0 review") aren't truncated.
    if (dot > 0 && /^[a-z0-9]{1,5}$/.test(s.slice(dot + 1))) {
      s = s.slice(0, dot)
    }
  }

  return s
    // Treat separators and punctuation as word boundaries.
    .replace(/[._\-|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w))
}

// Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|, in [0, 1].
// Returns null when either side has no usable tokens (comparison impossible).
export function computeFilenameSimilarity(
  filename: string,
  title: string,
): number | null {
  const fileTokens = new Set(normaliseForComparison(filename, { stripExtension: true }))
  const titleTokens = new Set(normaliseForComparison(title))

  if (fileTokens.size === 0 || titleTokens.size === 0) return null

  let intersection = 0
  for (const token of fileTokens) {
    if (titleTokens.has(token)) intersection++
  }
  const union = fileTokens.size + titleTokens.size - intersection
  if (union === 0) return null

  return Math.round((intersection / union) * 1000) / 1000
}

// Maps a similarity score (or null) to the filename validation status. A score
// at or above the threshold passes; below it warns; null means we couldn't
// compare and is reported as "unknown". Never used to block the user.
export function filenameStatusFromScore(
  score: number | null,
  threshold: number,
): FilenameValidationStatus {
  if (score == null) return "unknown"
  return score >= threshold ? "passed" : "warning"
}

// Combines the duration and filename outcomes into the overall status:
//   - duration failed            -> "failed" (regardless of filename)
//   - duration passed + filename passed -> "passed"
//   - duration passed + filename warning/unknown -> "warning"
export function computeOverallValidationStatus(
  durationStatus: DurationValidationStatus,
  filenameStatus: FilenameValidationStatus,
): OverallValidationStatus {
  if (durationStatus === "failed") return "failed"
  return filenameStatus === "passed" ? "passed" : "warning"
}
