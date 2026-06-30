// Orchestrates the two halves of a direct-to-storage upload: initiation (create
// the DB record + mint a signed upload target) and completion (verify the object
// landed, then kick off validation). Both are written as services that take their
// Supabase client and storage provider as arguments, so the route handlers stay
// thin and the ownership / object-missing / too-large branches are unit-testable
// with fakes.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getAnalysedVideo } from "@/lib/analysed-videos"
import {
  ACCEPTED_MIME_TYPES,
  getMaxUploadBytes,
  isAcceptedExtension,
} from "@/lib/source-files/config"
import {
  deleteSourceFileRow,
  getSourceFileById,
  replaceSourceFile,
  updateSourceFile,
  type SourceFile,
} from "@/lib/source-files/source-files"
import {
  computeValidationOutcome,
  defaultValidationDeps,
} from "@/lib/source-files/validation-service"
import type { SignedUpload, StorageProvider } from "@/lib/storage"
import { buildSourceFileObjectPath } from "@/lib/storage/provider"

// A tagged error so route handlers can map service failures to the right HTTP
// status without leaking internals.
export class UploadError extends Error {
  constructor(
    public readonly code:
      | "video_not_found"
      | "unsupported_type"
      | "file_too_large"
      | "not_found"
      | "object_missing"
      | "invalid",
    message: string,
  ) {
    super(message)
    this.name = "UploadError"
  }
}

export interface InitiateUploadParams {
  userId: string
  youtubeVideoId: string
  originalFilename: string
  mimeType?: string | null
  // Client-claimed size, used only for an early UX-level reject. The real size
  // is read from storage at completion and is the value we persist.
  declaredSizeBytes?: number | null
}

export interface InitiateUploadResult {
  sourceFile: SourceFile
  upload: SignedUpload
}

// Creates (or replaces) the pending source-file record for a YouTube video the
// user owns, then returns a signed direct-upload target scoped to a safe object
// path. Ownership is enforced two ways: the analysed video must exist for this
// user (RLS-scoped read below), and the storage path embeds the user + video id.
export async function initiateSourceFileUpload(
  supabase: SupabaseClient,
  storage: StorageProvider,
  params: InitiateUploadParams,
): Promise<InitiateUploadResult> {
  const filename = params.originalFilename?.trim()
  if (!filename) {
    throw new UploadError("invalid", "A filename is required.")
  }

  // Server-side format enforcement (the client checks too, for UX only).
  if (!isAcceptedExtension(filename)) {
    throw new UploadError(
      "unsupported_type",
      "Unsupported file type. Upload an mp4, mov, m4v, mkv or webm file.",
    )
  }
  if (
    params.mimeType &&
    params.mimeType !== "" &&
    !ACCEPTED_MIME_TYPES.includes(params.mimeType)
  ) {
    throw new UploadError(
      "unsupported_type",
      "Unsupported file type. Upload an mp4, mov, m4v, mkv or webm file.",
    )
  }

  const maxBytes = getMaxUploadBytes()
  if (
    typeof params.declaredSizeBytes === "number" &&
    params.declaredSizeBytes > maxBytes
  ) {
    throw new UploadError(
      "file_too_large",
      `That file is larger than the ${formatGb(maxBytes)} upload limit.`,
    )
  }

  // The video must already be analysed and owned by this user. getAnalysedVideo
  // is RLS-scoped, so a video on someone else's account simply returns null.
  const analysed = await getAnalysedVideo(
    supabase,
    params.userId,
    params.youtubeVideoId,
  )
  if (!analysed) {
    throw new UploadError(
      "video_not_found",
      "We couldn't find that analysed video on your account.",
    )
  }

  const youtubeDurationSeconds = analysed.videoDetails?.durationSeconds ?? 0

  // Replace any prior upload for this video with a fresh pending record. The old
  // storage object (if any) is cleaned up below so it doesn't linger.
  const { sourceFile, previousStoragePath } = await replaceSourceFile(supabase, {
    userId: params.userId,
    analysedVideoId: analysed.id,
    youtubeVideoId: params.youtubeVideoId,
    originalFilename: filename,
    mimeType: params.mimeType ?? null,
    storageProvider: storage.name,
    youtubeDurationSeconds,
  })

  if (previousStoragePath) {
    try {
      await storage.deleteObject(previousStoragePath)
    } catch (error) {
      // Best-effort cleanup — never block a new upload on a stale-object delete.
      console.error("Failed to delete previous source-file object", error)
    }
  }

  const path = buildSourceFileObjectPath({
    userId: params.userId,
    youtubeVideoId: params.youtubeVideoId,
    sourceFileId: sourceFile.id,
    originalFilename: filename,
  })

  let upload: SignedUpload
  try {
    upload = await storage.createSignedUpload(path)
  } catch (error) {
    // Record the failure on the row so the UI can show a retry CTA.
    await updateSourceFile(supabase, params.userId, sourceFile.id, {
      uploadStatus: "failed",
      validationStatus: "failed",
      failureReason: "Could not start the upload. Please try again.",
    }).catch(() => {})
    throw error
  }

  const updated = await updateSourceFile(supabase, params.userId, sourceFile.id, {
    storagePath: path,
    uploadStatus: "uploading",
  })

  return { sourceFile: updated, upload }
}

export interface CompleteUploadParams {
  userId: string
  sourceFileId: string
  // Duration (seconds) the browser measured for the file, or null when it
  // couldn't be read (e.g. .mkv, which most browsers can't decode). Drives the
  // duration-match check; null degrades that check to a soft "couldn't verify".
  clientDurationSeconds?: number | null
}

// Confirms a direct upload actually landed: verifies the object exists, reads its
// authoritative size/type from storage (never trusting the client), enforces the
// size cap, then validates and persists a terminal state in a single write.
// Validation is a fast, pure computation over the browser-measured duration, so
// the record never lingers in a non-terminal "uploaded"/"processing" state.
// Returns the post-validation source file.
export async function completeSourceFileUpload(
  supabase: SupabaseClient,
  storage: StorageProvider,
  params: CompleteUploadParams,
): Promise<SourceFile> {
  const sourceFile = await getSourceFileById(
    supabase,
    params.userId,
    params.sourceFileId,
  )
  if (!sourceFile) {
    throw new UploadError("not_found", "Source file not found.")
  }

  if (!sourceFile.storagePath) {
    throw new UploadError(
      "object_missing",
      "No upload target was recorded for this file. Please re-upload.",
    )
  }

  const info = await storage.statObject(sourceFile.storagePath)
  if (!info.exists) {
    await updateSourceFile(supabase, params.userId, sourceFile.id, {
      uploadStatus: "failed",
      validationStatus: "failed",
      failureReason: "The uploaded file could not be found in storage.",
    })
    throw new UploadError(
      "object_missing",
      "The uploaded file could not be found in storage. Please re-upload.",
    )
  }

  // Enforce the size cap against the real, storage-reported size.
  const maxBytes = getMaxUploadBytes()
  if (info.sizeBytes != null && info.sizeBytes > maxBytes) {
    await storage.deleteObject(sourceFile.storagePath).catch(() => {})
    await updateSourceFile(supabase, params.userId, sourceFile.id, {
      uploadStatus: "failed",
      validationStatus: "failed",
      failureReason: `That file is larger than the ${formatGb(maxBytes)} upload limit.`,
    })
    throw new UploadError(
      "file_too_large",
      `That file is larger than the ${formatGb(maxBytes)} upload limit.`,
    )
  }

  // Validate against the browser-measured duration and the YouTube title. This
  // is pure and instant, so we compute the verdict and write the final state in
  // one update — the row goes straight from "uploading" to a terminal state with
  // no probing step in between that could time out and strand it.
  const analysed = await getAnalysedVideo(
    supabase,
    params.userId,
    sourceFile.youtubeVideoId,
  )
  const outcome = computeValidationOutcome(
    {
      originalFilename: sourceFile.originalFilename,
      youtubeDurationSeconds:
        sourceFile.youtubeDurationSeconds ??
        analysed?.videoDetails?.durationSeconds ??
        0,
      videoTitle: analysed?.videoTitle ?? "",
      uploadedDurationSeconds: normaliseClientDuration(
        params.clientDurationSeconds,
      ),
    },
    defaultValidationDeps(),
  )

  return updateSourceFile(supabase, params.userId, sourceFile.id, {
    fileSizeBytes: info.sizeBytes,
    mimeType: info.contentType ?? sourceFile.mimeType,
    uploadStatus: outcome.uploadStatus,
    validationStatus: outcome.validationStatus,
    uploadedDurationSeconds: outcome.uploadedDurationSeconds,
    durationDifferenceSeconds: outcome.durationDifferenceSeconds,
    durationValidationStatus: outcome.durationValidationStatus,
    filenameValidationStatus: outcome.filenameValidationStatus,
    filenameSimilarityScore: outcome.filenameSimilarityScore,
    failureReason: outcome.failureReason,
  })
}

// Coerces the client-supplied duration into a usable positive number, or null
// when it's missing/garbage (NaN, Infinity, non-positive). Never trust the raw
// value: it comes straight from the browser.
function normaliseClientDuration(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

// True when a record is stuck in a non-terminal state it can never leave on its
// own. Completing an upload now writes a terminal state ("ready"/"failed") in a
// single update, so a persisted row is only ever legitimately "pending" or
// terminal. Any of the in-flight states therefore means a stranded record:
//   - "uploading": the browser-driven byte transfer was abandoned (the page that
//     would call complete-upload is gone), so it can never advance.
//   - "uploaded"/"processing": a row left behind by the old inline-ffprobe flow,
//     whose validation request was killed before it could settle. These states
//     are no longer written, so finding one means it's stranded.
// A freshly server-rendered page that finds any of these wipes the row so the
// user gets a clean upload CTA instead of a perpetual "Validating…" spinner.
export function isStaleSourceFile(sourceFile: SourceFile): boolean {
  return (
    sourceFile.uploadStatus === "uploading" ||
    sourceFile.uploadStatus === "uploaded" ||
    sourceFile.uploadStatus === "processing"
  )
}

// Discards an abandoned upload so the UI can fall back to a fresh upload CTA:
// removes the (possibly partial) storage object — best-effort, the same as the
// delete route — then deletes the DB row, which is the source of truth.
export async function discardSourceFile(
  supabase: SupabaseClient,
  storage: StorageProvider,
  userId: string,
  sourceFile: SourceFile,
): Promise<void> {
  if (sourceFile.storagePath) {
    try {
      await storage.deleteObject(sourceFile.storagePath)
    } catch (error) {
      console.error("Failed to delete stale source-file object", error)
    }
  }
  await deleteSourceFileRow(supabase, userId, sourceFile.id)
}

function formatGb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}
