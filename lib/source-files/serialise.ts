// Client-facing serialisation for a source file. Lives in its own module (with
// only type imports) so both server routes and client components can share the
// shape without dragging server-only code into the browser bundle. The raw
// storage path is intentionally never exposed — clients only get signed URLs.

import type { SourceFile } from "@/lib/source-files/source-files"

export interface SerialisedSourceFile {
  id: string
  youtubeVideoId: string
  originalFilename: string
  fileSizeBytes: number | null
  mimeType: string | null
  uploadedDurationSeconds: number | null
  youtubeDurationSeconds: number | null
  durationDifferenceSeconds: number | null
  durationValidationStatus: "passed" | "failed" | null
  filenameValidationStatus: "passed" | "warning" | "unknown" | null
  filenameSimilarityScore: number | null
  validationStatus: "pending" | "passed" | "warning" | "failed"
  uploadStatus:
    | "pending"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed"
  // Transcode (1080p proxy) lifecycle, so the UI can show "Optimising…" while a
  // job runs. The raw proxy/original storage paths are never exposed.
  normalisationStatus:
    | "pending"
    | "processing"
    | "ready"
    | "failed"
    | "skipped"
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export function serialiseSourceFile(sourceFile: SourceFile): SerialisedSourceFile {
  return {
    id: sourceFile.id,
    youtubeVideoId: sourceFile.youtubeVideoId,
    originalFilename: sourceFile.originalFilename,
    fileSizeBytes: sourceFile.fileSizeBytes,
    mimeType: sourceFile.mimeType,
    uploadedDurationSeconds: sourceFile.uploadedDurationSeconds,
    youtubeDurationSeconds: sourceFile.youtubeDurationSeconds,
    durationDifferenceSeconds: sourceFile.durationDifferenceSeconds,
    durationValidationStatus: sourceFile.durationValidationStatus,
    filenameValidationStatus: sourceFile.filenameValidationStatus,
    filenameSimilarityScore: sourceFile.filenameSimilarityScore,
    validationStatus: sourceFile.validationStatus,
    uploadStatus: sourceFile.uploadStatus,
    normalisationStatus: sourceFile.normalisationStatus,
    failureReason: sourceFile.failureReason,
    createdAt: sourceFile.createdAt,
    updatedAt: sourceFile.updatedAt,
  }
}
