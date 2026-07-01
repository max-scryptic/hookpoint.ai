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
  return `${params.userId}/${params.analysedVideoId}/${params.retentionWindowId}/audio.aac`
}
