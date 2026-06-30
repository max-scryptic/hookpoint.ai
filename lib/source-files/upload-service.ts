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
  getMultipartThresholdBytes,
  isAcceptedExtension,
} from "@/lib/source-files/config"
import {
  deleteSourceFileRow,
  getSourceFileById,
  replaceSourceFile,
  updateSourceFile,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type {
  CompletedPart,
  MultipartUpload,
  SignedUpload,
  StorageProvider,
} from "@/lib/storage"
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
  // Exactly one of these is set: `upload` for the single-PUT path, or
  // `multipartUpload` when the provider supports parallel parts and the file is
  // large enough to be worth splitting.
  upload?: SignedUpload
  multipartUpload?: MultipartUpload
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

  // Use a parallel multipart upload when the provider supports it and the file
  // is large enough to benefit; otherwise mint a single signed PUT. Multipart is
  // what lets the browser open several streams and actually fill the uplink on a
  // multi-GB file instead of being capped by one TCP stream.
  const useMultipart =
    typeof storage.createMultipartUpload === "function" &&
    params.declaredSizeBytes != null &&
    params.declaredSizeBytes >= getMultipartThresholdBytes()

  let upload: SignedUpload | undefined
  let multipartUpload: MultipartUpload | undefined
  try {
    if (useMultipart) {
      multipartUpload = await storage.createMultipartUpload!(path, {
        totalSizeBytes: params.declaredSizeBytes!,
        contentType: params.mimeType ?? null,
      })
    } else {
      upload = await storage.createSignedUpload(path)
    }
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

  return { sourceFile: updated, upload, multipartUpload }
}

export interface CompleteUploadParams {
  userId: string
  sourceFileId: string
  // Present only for multipart uploads: the storage-side upload id plus the
  // per-part ETags the browser collected. Used to assemble the final object
  // before we verify it exists.
  multipart?: {
    uploadId: string
    parts: CompletedPart[]
  }
}

// Confirms a direct upload actually landed: verifies the object exists, reads its
// authoritative size/type from storage (never trusting the client), enforces the
// size cap, marks the record "uploaded", then runs validation. Returns the
// post-validation source file.
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

  // For a multipart upload the object doesn't exist until we assemble the parts.
  // Do that first, so the statObject check below sees the finished object.
  if (params.multipart && typeof storage.completeMultipartUpload === "function") {
    try {
      await storage.completeMultipartUpload(
        sourceFile.storagePath,
        params.multipart.uploadId,
        params.multipart.parts,
      )
    } catch (error) {
      console.error("Failed to complete multipart upload", error)
      await updateSourceFile(supabase, params.userId, sourceFile.id, {
        uploadStatus: "failed",
        validationStatus: "failed",
        failureReason: "The upload could not be finalised. Please re-upload.",
      })
      throw new UploadError(
        "object_missing",
        "The upload could not be finalised. Please re-upload.",
      )
    }
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

  await updateSourceFile(supabase, params.userId, sourceFile.id, {
    fileSizeBytes: info.sizeBytes,
    mimeType: info.contentType ?? sourceFile.mimeType,
    uploadStatus: "uploaded",
  })

  // Run validation inline for the MVP. The validation service owns its own
  // (service-role) client and is structured so it can later be dispatched to a
  // background worker instead of awaited here. Imported lazily so the ffprobe /
  // child_process dependency only loads on this completion path, never in the
  // upload-initiation route.
  const { validateSourceFile } = await import(
    "@/lib/source-files/validation-service"
  )
  await validateSourceFile(sourceFile.id)

  const finalState = await getSourceFileById(
    supabase,
    params.userId,
    sourceFile.id,
  )
  // Should always exist; fall back to the pre-validation row defensively.
  return finalState ?? sourceFile
}

// True when a record represents an upload that was abandoned mid-flight. The
// byte transfer is driven entirely by the browser, so once the page that started
// it is gone the "uploading" state can never advance on its own — there is no
// client left to call complete-upload. A freshly server-rendered page that finds
// a record in this state is therefore looking at a stranded upload. (The later
// "uploaded"/"processing" states run inside the awaited complete-upload request
// and settle to a terminal state server-side, so they are deliberately excluded.)
export function isStaleSourceFile(sourceFile: SourceFile): boolean {
  return sourceFile.uploadStatus === "uploading"
}

// Discards an abandoned upload so the UI can fall back to a fresh upload CTA:
// removes the (possibly partial) storage object — best-effort, the same as the
// delete route — then deletes the DB row, which is the source of truth.
//
// Note for multipart uploads abandoned via a tab-close: there is no completed
// object to delete here (the parts are only assembled at completion), and we
// don't have the upload id at this point, so the orphaned parts are left for the
// bucket's "abort incomplete multipart uploads" lifecycle rule to reap. The
// graceful client-error path calls abortSourceFileUpload instead, which does have
// the id and cleans the parts up immediately.
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

export interface AbortUploadParams {
  userId: string
  sourceFileId: string
  // Set when aborting a multipart upload, so the uploaded parts can be discarded
  // immediately rather than waiting for the bucket lifecycle rule.
  uploadId?: string
}

// Cancels an in-flight upload the browser gave up on (a part failed, the user
// cancelled). Aborts the multipart upload to free its parts when we have the id,
// then discards the row + any object so the slot is clean for a retry. All
// best-effort: a failure to abort must never stop the row being cleared.
export async function abortSourceFileUpload(
  supabase: SupabaseClient,
  storage: StorageProvider,
  params: AbortUploadParams,
): Promise<void> {
  const sourceFile = await getSourceFileById(
    supabase,
    params.userId,
    params.sourceFileId,
  )
  if (!sourceFile) return

  if (
    params.uploadId &&
    sourceFile.storagePath &&
    typeof storage.abortMultipartUpload === "function"
  ) {
    try {
      await storage.abortMultipartUpload(sourceFile.storagePath, params.uploadId)
    } catch (error) {
      console.error("Failed to abort multipart upload", error)
    }
  }

  await discardSourceFile(supabase, storage, params.userId, sourceFile)
}

function formatGb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}
