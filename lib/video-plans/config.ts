// Configuration for the Video Planner: the thumbnail bucket and the limits its
// uploads are held to. The footage side of a plan is configured by
// lib/source-files/config.ts, which it shares with every other upload.
//
// Imports nothing, so the builder form can read the accepted formats and the
// size cap straight from here and enforce in the browser exactly what the
// server will. The provider that actually reaches the bucket lives in
// lib/video-plans/storage.ts, which pulls in the storage SDKs and must never be
// imported from a client component.

// Private bucket the plan thumbnails live in, mirroring the source-files bucket:
// access is only ever through a server-minted signed URL.
export function getVideoPlanThumbnailBucket(): string {
  return process.env.VIDEO_PLAN_THUMBNAIL_BUCKET || "video-plan-thumbnails"
}

// Hard cap on a thumbnail upload, matching the bucket's file_size_limit in the
// migration. Well above YouTube's own 2 MB ceiling, so this only ever catches a
// mistake such as a full-resolution export.
export function getMaxThumbnailBytes(): number {
  const raw = process.env.VIDEO_PLAN_MAX_THUMBNAIL_BYTES
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 1024 * 1024
}

// The image formats YouTube accepts for a thumbnail, as (extension -> mime
// type). Enforced in the browser for fast feedback and again on the server.
export const ACCEPTED_THUMBNAIL_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export const ACCEPTED_THUMBNAIL_EXTENSIONS = Object.keys(
  ACCEPTED_THUMBNAIL_TYPES,
)

export const MAX_THUMBNAILS = 3

export const ACCEPTED_THUMBNAIL_MIME_TYPES = [
  ...new Set(Object.values(ACCEPTED_THUMBNAIL_TYPES)),
]

// The storage extension for an uploaded thumbnail, chosen from its mime type
// rather than its filename: the mime type is what storage will serve it back
// as, and a file named ".jpg" that is really a PNG would otherwise be stored
// under a lying extension. Falls back to jpg for anything unrecognised, which
// the mime-type check upstream has already ruled out.
export function thumbnailExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    default:
      return "jpg"
  }
}

export function isAcceptedThumbnailMimeType(mimeType: string): boolean {
  return ACCEPTED_THUMBNAIL_MIME_TYPES.includes(mimeType)
}

// The opening stretch of the footage treated as "the hook", matching the window
// the published-video packaging read uses (lib/packaging-alignment.ts) so a
// plan and a report are talking about the same thing.
export const PLAN_HOOK_WINDOW_SECONDS = 30
