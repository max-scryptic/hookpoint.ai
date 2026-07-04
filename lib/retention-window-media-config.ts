// Configuration for harvesting thumbnails/audio from a retention window's
// analysis range. Reuses the S3 config the source-file pipeline already reads
// (lib/source-files/config.ts) so both features stay pointed at the same
// storage backend, but writes to a bucket of their own.

import { getS3Config } from "@/lib/source-files/config"
import type { StorageProvider } from "@/lib/storage"
import { S3StorageProvider } from "@/lib/storage/s3-storage"
import { SupabaseStorageProvider } from "@/lib/storage/supabase-storage"

// Object-storage bucket the extracted thumbnails/audio clips live in.
export function getRetentionWindowMediaBucket(): string {
  return process.env.RETENTION_WINDOW_MEDIA_BUCKET || "retention-window-media"
}

export function getRetentionWindowMediaStorageProvider(): StorageProvider {
  const bucket = getRetentionWindowMediaBucket()
  const s3 = getS3Config()
  if (s3) {
    return new S3StorageProvider(bucket, s3)
  }
  return new SupabaseStorageProvider(bucket)
}

// How long the signed read URL handed to ffmpeg for the source video stays
// valid. One URL is minted per extraction run and reused across every chunk's
// seek, so this needs to comfortably outlast the whole run, not just one seek.
// Default 30 minutes.
export function getSourceVideoReadUrlExpirySeconds(): number {
  const raw = process.env.RETENTION_WINDOW_SOURCE_URL_EXPIRY_SECONDS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60
}

// Builds the object key for one harvested asset. Scoped by user/video/window
// the same way source-file object paths are, so a signed URL for one user's
// media can never reach another user's.
export function buildRetentionSnapshotObjectPath(params: {
  userId: string
  analysedVideoId: string
  retentionWindowId: string
  chunkIndex: number
}): string {
  return `${params.userId}/${params.analysedVideoId}/${params.retentionWindowId}/snapshot-${params.chunkIndex}.jpg`
}

export function buildRetentionAudioObjectPath(params: {
  userId: string
  analysedVideoId: string
  retentionWindowId: string
}): string {
  return `${params.userId}/${params.analysedVideoId}/${params.retentionWindowId}/audio.mp3`
}

// Largest source video an extraction run will copy onto the function's own
// disk before decoding (see lib/media/local-source-cache.ts). Anything larger
// streams from the signed URL as before. Kept comfortably under Vercel's
// default 512MB /tmp, which is also shared across warm invocations. Set to 0
// to disable local caching entirely.
export function getLocalSourceCacheMaxBytes(): number {
  const raw = process.env.RETENTION_WINDOW_LOCAL_SOURCE_MAX_BYTES
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : 400 * 1024 * 1024
}

// How many snapshot/audio/scene-cue-scan rows an extraction run processes at
// once. Each row spawns its own ffmpeg subprocess and network seek into the
// signed source URL, and rows are fully independent (own status column, own
// storage object), so serializing them one-at-a-time only adds wall-clock
// time for no correctness benefit. Bounded rather than unlimited so one run
// can't spike CPU/network past what the host (or the signed URL's storage
// backend) can comfortably serve at once.
//
// Default 2, not 4: a scene-cue scan decodes every frame of its window at
// full source resolution before the scale filter downsamples it, which is
// genuinely CPU-bound — on a Vercel serverless function's single (or
// fractional) vCPU, 4 of those running at once means each gets a quarter of
// one core, which routinely pushed a 30-40s window's decode past the 90s
// scanVideoSceneCues timeout (or, worse, past the surrounding route's whole
// 300s budget) even though the same decode comfortably finishes in well
// under 90s with no contention. Halving it trades some run-to-run throughput
// for those scans actually completing instead of timing out and endlessly
// retrying.
export function getRetentionWindowExtractionConcurrency(): number {
  const raw = process.env.RETENTION_WINDOW_EXTRACTION_CONCURRENCY
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2
}

// How many windows' worth of OpenAI calls (vision/audio analysis, event
// synthesis) run at once. Unlike extraction's ffmpeg concurrency above, these
// calls are network-bound, not CPU-bound — the wait is almost entirely on
// OpenAI's side, so there's no local-CPU-contention reason to keep this low.
// Every window is fully independent (own rows, own storage objects), the same
// property that makes extraction's concurrency safe. Default 5, comfortably
// under typical per-account OpenAI rate limits while still turning what would
// otherwise be dozens of sequential round-trips into a handful of batches.
export function getRetentionWindowAiCallConcurrency(): number {
  const raw = process.env.RETENTION_WINDOW_AI_CALL_CONCURRENCY
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5
}

// OpenAI model used to describe a window's harvested snapshots (vision input).
// Defaults to the same model already used for transcript pacing analysis.
export function getSnapshotAnalysisModel(): string {
  return process.env.OPENAI_SNAPSHOT_ANALYSIS_MODEL || "gpt-5.4-mini"
}

// OpenAI model used to describe a window's harvested audio clip (audio
// input). Must be an audio-capable Chat Completions model — gpt-5.4-mini
// (used for the other analysis steps) has no audio modality at all.
export function getAudioAnalysisModel(): string {
  return process.env.OPENAI_AUDIO_ANALYSIS_MODEL || "gpt-audio-mini"
}

// OpenAI model used for the per-window cross-modal event-synthesis call
// (lib/retention-window-event-synthesis.ts). Text-only — it consumes the
// already-computed structured evidence, not raw media — so this can be a
// cheaper/faster model independent of the vision/audio models above.
export function getEventSynthesisModel(): string {
  return process.env.OPENAI_EVENT_SYNTHESIS_MODEL || "gpt-5.4-mini"
}

// How long the signed read URL handed to OpenAI for a harvested snapshot
// stays valid. Short-lived since it's minted right before the request that
// consumes it, unlike the source-video URL which is reused across a whole
// extraction run. Default 10 minutes.
export function getAnalysisMediaReadUrlExpirySeconds(): number {
  const raw = process.env.RETENTION_WINDOW_ANALYSIS_MEDIA_URL_EXPIRY_SECONDS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60
}
