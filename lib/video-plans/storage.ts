// The storage provider bound to the plan-thumbnail bucket. Split from
// lib/video-plans/config.ts because building a provider pulls in the storage
// SDKs, and the builder form reads the limits in that module from the browser.

import { getS3Config } from "@/lib/source-files/config"
import type { StorageProvider } from "@/lib/storage"
import { S3StorageProvider } from "@/lib/storage/s3-storage"
import { SupabaseStorageProvider } from "@/lib/storage/supabase-storage"
import { getVideoPlanThumbnailBucket } from "@/lib/video-plans/config"

// Same provider choice as the source files (S3-compatible when configured,
// Supabase Storage otherwise), pointed at a different bucket - thumbnails are
// images, and the source-files bucket only admits video containers.
export function getThumbnailStorageProvider(): StorageProvider {
  const bucket = getVideoPlanThumbnailBucket()
  const s3 = getS3Config()
  if (s3) {
    return new S3StorageProvider(bucket, s3)
  }
  return new SupabaseStorageProvider(bucket)
}
