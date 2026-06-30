// Centralised, env-overridable configuration for the raw source-file upload +
// validation pipeline. Kept in one place so the API routes, the validation
// service and the (future) background worker all agree on the same limits.

// How far the uploaded file's duration may differ from the YouTube-reported
// duration and still count as the same video. Default 5 seconds.
export function getDurationToleranceSeconds(): number {
  const raw = process.env.SOURCE_FILE_DURATION_TOLERANCE_SECONDS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5
}

// Minimum filename/title similarity (0..1) below which we show the soft
// "filename doesn't look like the title" warning. Never blocks the user.
export function getFilenameSimilarityThreshold(): number {
  const raw = process.env.SOURCE_FILE_FILENAME_SIMILARITY_THRESHOLD
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.3
}

// Object-storage bucket the raw uploads live in. Private; access is always
// mediated by server-created signed URLs.
export function getSourceFileBucket(): string {
  return process.env.SOURCE_FILE_BUCKET || "source-files"
}

// Hard cap on accepted upload size, in bytes. Defaults to 30 GB, matching the
// bucket's file_size_limit in the migration.
export function getMaxUploadBytes(): number {
  const raw = process.env.SOURCE_FILE_MAX_UPLOAD_BYTES
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 1024 * 1024 * 1024
}

// Target size of each multipart chunk, in bytes. Default 64 MiB — big enough to
// keep the part count modest for a 30 GB file (~480 parts) while small enough
// that several upload in parallel without each one being a huge retry unit. The
// provider may grow this to stay under S3's 10,000-part ceiling.
export function getMultipartPartSizeBytes(): number {
  const raw = process.env.SOURCE_FILE_MULTIPART_PART_SIZE_BYTES
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 64 * 1024 * 1024
}

// File size at or above which we use a parallel multipart upload instead of a
// single PUT. Below it the multipart overhead isn't worth it. Defaults to the
// part size, so any file that would span more than one part goes multipart.
export function getMultipartThresholdBytes(): number {
  const raw = process.env.SOURCE_FILE_MULTIPART_THRESHOLD_BYTES
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : getMultipartPartSizeBytes()
}

// How long signed upload targets (single PUT or each multipart part URL) stay
// valid. Default 6 hours, generous enough to cover a slow multi-GB upload over a
// modest uplink without the URLs expiring mid-flight.
export function getSignedUploadExpirySeconds(): number {
  const raw = process.env.SOURCE_FILE_SIGNED_UPLOAD_EXPIRY_SECONDS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6 * 60 * 60
}

// S3-compatible storage connection. When all four values are present we use the
// S3 provider (which supports parallel multipart uploads); otherwise we fall
// back to the single-PUT Supabase Storage client. Supabase exposes these under
// Project Settings → Storage → S3 connection.
export interface S3Config {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function getS3Config(): S3Config | null {
  const endpoint = process.env.SOURCE_FILE_S3_ENDPOINT
  const region = process.env.SOURCE_FILE_S3_REGION
  const accessKeyId = process.env.SOURCE_FILE_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.SOURCE_FILE_S3_SECRET_ACCESS_KEY
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    return null
  }
  return { endpoint, region, accessKeyId, secretAccessKey }
}

// The video container formats we accept, as (extension -> mime type). Enforced
// client-side for UX and again server-side on upload initiation.
export const ACCEPTED_VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  webm: "video/webm",
}

// Accepted file extensions (no leading dot), derived from ACCEPTED_VIDEO_TYPES.
export const ACCEPTED_EXTENSIONS = Object.keys(ACCEPTED_VIDEO_TYPES)

// All mime types we accept. Includes a couple of common alternate spellings
// browsers emit for the same containers.
export const ACCEPTED_MIME_TYPES: string[] = [
  ...new Set([
    ...Object.values(ACCEPTED_VIDEO_TYPES),
    "video/webm",
    "video/quicktime",
    "video/mp4",
    "video/x-matroska",
    "application/octet-stream", // some browsers send this for .mkv/.mov
  ]),
]

// Returns the lowercased extension (without the dot) of a filename, or "".
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".")
  if (dot === -1 || dot === filename.length - 1) return ""
  return filename.slice(dot + 1).toLowerCase()
}

// True when the filename's extension is one of the accepted video containers.
export function isAcceptedExtension(filename: string): boolean {
  return ACCEPTED_EXTENSIONS.includes(fileExtension(filename))
}
