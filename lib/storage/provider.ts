// Resolves the storage provider the app is configured to use. Today this is
// always Supabase Storage; the indirection keeps a single switch-point for when
// we add an S3/R2 or resumable-TUS backend.

import { getSourceFileBucket } from "@/lib/source-files/config"
import type { StorageProvider } from "@/lib/storage"
import { SupabaseStorageProvider } from "@/lib/storage/supabase-storage"

export function getStorageProvider(): StorageProvider {
  return new SupabaseStorageProvider(getSourceFileBucket())
}

// Builds the object key for a user's upload. The path is deliberately scoped by
// user_id and youtube_video_id so a signed URL can never reach another user's or
// another video's files, and the per-source-file id keeps re-uploads distinct.
export function buildSourceFileObjectPath(params: {
  userId: string
  youtubeVideoId: string
  sourceFileId: string
  originalFilename: string
}): string {
  const safeName = sanitiseFilename(params.originalFilename)
  return `${params.userId}/${params.youtubeVideoId}/${params.sourceFileId}/${safeName}`
}

// Reduces a client-provided filename to a safe storage leaf: keeps the
// extension, strips path separators and anything that isn't an alnum/dot/dash/
// underscore, and caps the length.
export function sanitiseFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._]+/, "")
  const trimmed = cleaned.slice(0, 200)
  return trimmed.length > 0 ? trimmed : "upload"
}
