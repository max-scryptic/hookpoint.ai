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
  replaceVideoPlanSourceFile,
  updateSourceFile,
  type SourceFile,
} from "@/lib/source-files/source-files"
import {
  computeValidationOutcome,
  defaultValidationDeps,
  type ValidationOutcome,
} from "@/lib/source-files/validation-service"
import { startNormalisation } from "@/lib/source-files/normalisation-service"
import type {
  CompletedPart,
  MultipartUpload,
  SignedUpload,
  StorageProvider,
} from "@/lib/storage"
import {
  buildSourceFileObjectPath,
  buildVideoPlanSourceFileObjectPath,
} from "@/lib/storage/provider"
import { getVideoPlan } from "@/lib/video-plans/video-plans"

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
  // Upload size cap in bytes for this user's plan. Falls back to the global
  // storage cap when omitted, so callers without plan context still get the
  // hard bucket limit. The route resolves this from the user's entitlement.
  maxUploadBytes?: number | null
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
  const filename = assertUploadableFile(params)

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
  const {
    sourceFile,
    previousStoragePath,
    previousProxyStoragePath,
    previousAnalysisProxyStoragePath,
  } = await replaceSourceFile(supabase, {
    userId: params.userId,
    analysedVideoId: analysed.id,
    youtubeVideoId: params.youtubeVideoId,
    originalFilename: filename,
    mimeType: params.mimeType ?? null,
    storageProvider: storage.name,
    youtubeDurationSeconds,
  })

  // Best-effort cleanup of the replaced upload's objects (original + any
  // proxies) - never block a new upload on a stale-object delete.
  for (const stalePath of [
    previousStoragePath,
    previousProxyStoragePath,
    previousAnalysisProxyStoragePath,
  ]) {
    if (!stalePath) continue
    try {
      await storage.deleteObject(stalePath)
    } catch (error) {
      console.error("Failed to delete previous source-file object", error)
    }
  }

  const path = buildSourceFileObjectPath({
    userId: params.userId,
    youtubeVideoId: params.youtubeVideoId,
    sourceFileId: sourceFile.id,
    originalFilename: filename,
  })

  return mintUploadTarget(supabase, storage, {
    userId: params.userId,
    sourceFile,
    path,
    declaredSizeBytes: params.declaredSizeBytes ?? null,
    mimeType: params.mimeType ?? null,
  })
}

export interface InitiateVideoPlanUploadParams {
  userId: string
  videoPlanId: string
  originalFilename: string
  mimeType?: string | null
  declaredSizeBytes?: number | null
  maxUploadBytes?: number | null
}

// The video-plan counterpart of initiateSourceFileUpload. Same format and size
// enforcement, same direct-to-storage target; what differs is the owner it
// proves (the plan, not an analysed video) and the object path it writes to.
export async function initiateVideoPlanSourceFileUpload(
  supabase: SupabaseClient,
  storage: StorageProvider,
  params: InitiateVideoPlanUploadParams,
): Promise<InitiateUploadResult> {
  const filename = assertUploadableFile(params)

  // getVideoPlan is RLS-scoped, so another account's plan simply reads as null
  // and can never be uploaded into.
  const plan = await getVideoPlan(supabase, params.userId, params.videoPlanId)
  if (!plan) {
    throw new UploadError(
      "video_not_found",
      "We couldn't find that video plan on your account.",
    )
  }

  const { sourceFile, previousStoragePaths } = await replaceVideoPlanSourceFile(
    supabase,
    {
      userId: params.userId,
      videoPlanId: params.videoPlanId,
      originalFilename: filename,
      mimeType: params.mimeType ?? null,
      storageProvider: storage.name,
    },
  )

  // Best-effort cleanup of the replaced upload's objects, as for an analysed
  // video: a stale-object delete must never block a new upload.
  for (const stalePath of previousStoragePaths) {
    if (!stalePath) continue
    try {
      await storage.deleteObject(stalePath)
    } catch (error) {
      console.error("Failed to delete previous source-file object", error)
    }
  }

  const path = buildVideoPlanSourceFileObjectPath({
    userId: params.userId,
    videoPlanId: params.videoPlanId,
    sourceFileId: sourceFile.id,
    originalFilename: filename,
  })

  return mintUploadTarget(supabase, storage, {
    userId: params.userId,
    sourceFile,
    path,
    declaredSizeBytes: params.declaredSizeBytes ?? null,
    mimeType: params.mimeType ?? null,
  })
}

// The checks that don't care who owns the upload: a filename is present, the
// container is one we accept, and the claimed size is inside the plan's cap.
// Returns the trimmed filename. Throws an UploadError the routes map to a
// status code.
function assertUploadableFile(params: {
  originalFilename: string
  mimeType?: string | null
  declaredSizeBytes?: number | null
  maxUploadBytes?: number | null
}): string {
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

  const maxBytes = params.maxUploadBytes ?? getMaxUploadBytes()
  if (
    typeof params.declaredSizeBytes === "number" &&
    params.declaredSizeBytes > maxBytes
  ) {
    throw new UploadError(
      "file_too_large",
      `That file is larger than the ${formatGb(maxBytes)} upload limit.`,
    )
  }

  return filename
}

// Mints the signed direct-to-storage target for a freshly created record and
// moves it to "uploading". Shared by both owners: the only thing that varies
// upstream is which row was created and which object path it writes to.
async function mintUploadTarget(
  supabase: SupabaseClient,
  storage: StorageProvider,
  params: {
    userId: string
    sourceFile: SourceFile
    path: string
    declaredSizeBytes: number | null
    mimeType: string | null
  },
): Promise<InitiateUploadResult> {
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
      multipartUpload = await storage.createMultipartUpload!(params.path, {
        totalSizeBytes: params.declaredSizeBytes!,
        contentType: params.mimeType,
      })
    } else {
      upload = await storage.createSignedUpload(params.path)
    }
  } catch (error) {
    // Record the failure on the row so the UI can show a retry CTA.
    await updateSourceFile(supabase, params.userId, params.sourceFile.id, {
      uploadStatus: "failed",
      validationStatus: "failed",
      failureReason: "Could not start the upload. Please try again.",
    }).catch(() => {})
    throw error
  }

  const updated = await updateSourceFile(
    supabase,
    params.userId,
    params.sourceFile.id,
    {
      storagePath: params.path,
      uploadStatus: "uploading",
    },
  )

  return { sourceFile: updated, upload, multipartUpload }
}

export interface CompleteUploadParams {
  userId: string
  sourceFileId: string
  // Duration (seconds) the browser measured for the file, or null when it
  // couldn't be read (e.g. .mkv, which most browsers can't decode). Drives the
  // duration-match check; null degrades that check to a soft "couldn't verify".
  clientDurationSeconds?: number | null
  // Present only for multipart uploads: the storage-side upload id plus the
  // per-part ETags the browser collected. Used to assemble the final object
  // before we verify it exists.
  multipart?: {
    uploadId: string
    parts: CompletedPart[]
  }
  // Upload size cap in bytes for this user's plan (see InitiateUploadParams).
  maxUploadBytes?: number | null
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
  const maxBytes = params.maxUploadBytes ?? getMaxUploadBytes()
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
  // one update - the row goes straight from "uploading" to a terminal state with
  // no probing step in between that could time out and strand it.
  //
  // A plan-owned upload has nothing to validate against: the video is not
  // published, so there is no YouTube duration to match and no title for the
  // filename to resemble. Both checks would be answering a question nobody
  // asked, so it skips straight to "ready" and only records what the browser
  // measured.
  const measuredDuration = normaliseClientDuration(params.clientDurationSeconds)
  let outcome: ValidationOutcome
  if (sourceFile.videoPlanId) {
    outcome = videoPlanValidationOutcome(measuredDuration)
  } else {
    const analysed = await getAnalysedVideo(
      supabase,
      params.userId,
      sourceFile.youtubeVideoId ?? "",
    )
    outcome = computeValidationOutcome(
      {
        originalFilename: sourceFile.originalFilename,
        youtubeDurationSeconds:
          sourceFile.youtubeDurationSeconds ??
          analysed?.videoDetails?.durationSeconds ??
          0,
        videoTitle: analysed?.videoTitle ?? "",
        uploadedDurationSeconds: measuredDuration,
      },
      defaultValidationDeps(),
    )
  }

  const updated = await updateSourceFile(supabase, params.userId, sourceFile.id, {
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

  // Once the upload is good, hand the original off to be normalised into a 360p
  // proxy (after which the original is deleted). Best-effort and gated: when
  // normalisation is disabled this returns the row unchanged, so the original
  // simply remains the served file.
  if (updated.uploadStatus === "ready") {
    return startNormalisation(supabase, storage, updated)
  }

  return updated
}

// The settled state of a video-plan upload. There is no published video to
// check it against, so the only two verdicts a plan file can reach are "the
// object landed" (ready) and the failures completeSourceFileUpload has already
// written by the time it gets here (missing object, over the size cap). The
// duration is still recorded, because the packaging read needs to know the
// footage is long enough to hold a hook.
function videoPlanValidationOutcome(
  uploadedDurationSeconds: number | null,
): ValidationOutcome {
  return {
    uploadStatus: "ready",
    validationStatus: "passed",
    uploadedDurationSeconds,
    durationDifferenceSeconds: null,
    durationValidationStatus: null,
    filenameValidationStatus: "unknown",
    filenameSimilarityScore: null,
    failureReason: null,
  }
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
// removes the (possibly partial) storage object - best-effort, the same as the
// delete route - then deletes the DB row, which is the source of truth.
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
  for (const path of [sourceFile.storagePath, sourceFile.proxyStoragePath]) {
    if (!path) continue
    try {
      await storage.deleteObject(path)
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
