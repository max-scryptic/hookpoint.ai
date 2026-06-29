// The validation service: given an uploaded source file, extract its real
// duration with ffprobe, compare it to the YouTube-reported duration, run the
// soft filename/title similarity check, and persist the verdict.
//
// The pipeline is split into a pure-ish orchestrator (`computeValidationOutcome`)
// that takes all of its collaborators as injected dependencies, and a thin
// production entry point (`validateSourceFile`) that wires those collaborators to
// the real database, storage provider and ffprobe binary. This split means the
// whole decision flow — including "object missing" and "ffprobe failed" — can be
// unit-tested with fakes, and the orchestrator can be lifted into a background
// worker unchanged: the worker just calls `validateSourceFile(id)`.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  FfprobeReadError,
  FfprobeUnavailableError,
  extractDurationSeconds,
} from "@/lib/source-files/ffprobe"
import {
  getDurationToleranceSeconds,
  getFilenameSimilarityThreshold,
} from "@/lib/source-files/config"
import type {
  DurationValidationStatus,
  FilenameValidationStatus,
  UploadStatus,
  ValidationStatus,
} from "@/lib/source-files/source-files"
import {
  compareDuration,
  computeFilenameSimilarity,
  computeOverallValidationStatus,
  filenameStatusFromScore,
} from "@/lib/source-files/validation"
import { getStorageProvider } from "@/lib/storage/provider"
import type { StorageProvider } from "@/lib/storage"

// Everything the orchestrator needs to know about the file under validation.
export interface ValidationContext {
  sourceFileId: string
  storagePath: string | null
  originalFilename: string
  // YouTube-reported duration (seconds) captured from the analysed video.
  youtubeDurationSeconds: number
  // The YouTube video title, used for the soft filename similarity check.
  videoTitle: string
}

// Injected collaborators. Defaults wire to the real storage provider, ffprobe
// binary and configured thresholds; tests pass fakes.
export interface ValidationDeps {
  storage: StorageProvider
  extractDuration: (input: string) => Promise<number>
  toleranceSeconds: number
  filenameThreshold: number
}

// The persisted result of a validation run.
export interface ValidationOutcome {
  uploadStatus: UploadStatus
  validationStatus: ValidationStatus
  uploadedDurationSeconds: number | null
  durationDifferenceSeconds: number | null
  durationValidationStatus: DurationValidationStatus | null
  filenameValidationStatus: FilenameValidationStatus
  filenameSimilarityScore: number | null
  failureReason: string | null
}

export function defaultValidationDeps(): ValidationDeps {
  return {
    storage: getStorageProvider(),
    extractDuration: (input) => extractDurationSeconds(input),
    toleranceSeconds: getDurationToleranceSeconds(),
    filenameThreshold: getFilenameSimilarityThreshold(),
  }
}

// Runs the full validation decision for one source file. Pure with respect to
// its inputs: all I/O is delegated to `deps`, so the branching (object missing,
// ffprobe unavailable, ffprobe can't read, duration mismatch, pass/warning) is
// directly testable.
export async function computeValidationOutcome(
  ctx: ValidationContext,
  deps: ValidationDeps,
): Promise<ValidationOutcome> {
  // The filename/title similarity is independent of the file bytes, so compute
  // it up front — it's reported even when duration validation fails.
  const filenameSimilarityScore = computeFilenameSimilarity(
    ctx.originalFilename,
    ctx.videoTitle,
  )
  const filenameValidationStatus = filenameStatusFromScore(
    filenameSimilarityScore,
    deps.filenameThreshold,
  )

  // The object must exist in storage before we can probe it. A missing object
  // after "complete upload" is a hard failure.
  if (!ctx.storagePath) {
    return failed(
      "Uploaded file is missing from storage.",
      filenameValidationStatus,
      filenameSimilarityScore,
    )
  }

  const info = await deps.storage.statObject(ctx.storagePath)
  if (!info.exists) {
    return failed(
      "Uploaded file is missing from storage.",
      filenameValidationStatus,
      filenameSimilarityScore,
    )
  }

  // Probe the duration via a signed read URL so ffprobe reads only the metadata
  // it needs over range requests, instead of pulling the whole file.
  let uploadedDurationSeconds: number
  try {
    const readUrl = await deps.storage.createSignedReadUrl(ctx.storagePath)
    uploadedDurationSeconds = await deps.extractDuration(readUrl)
  } catch (error) {
    if (error instanceof FfprobeUnavailableError) {
      return failed(
        "Could not read the video duration: the processing tool is unavailable. Please try again later.",
        filenameValidationStatus,
        filenameSimilarityScore,
      )
    }
    if (error instanceof FfprobeReadError) {
      return failed(
        "Could not read the video duration from the uploaded file. It may be corrupt or in an unsupported format.",
        filenameValidationStatus,
        filenameSimilarityScore,
      )
    }
    return failed(
      "Could not read the uploaded file for validation.",
      filenameValidationStatus,
      filenameSimilarityScore,
    )
  }

  const duration = compareDuration(
    uploadedDurationSeconds,
    ctx.youtubeDurationSeconds,
    deps.toleranceSeconds,
  )

  if (duration.status === "failed") {
    return {
      uploadStatus: "failed",
      validationStatus: "failed",
      uploadedDurationSeconds: duration.uploadedDurationSeconds,
      durationDifferenceSeconds: duration.differenceSeconds,
      durationValidationStatus: "failed",
      filenameValidationStatus,
      filenameSimilarityScore,
      failureReason: `The uploaded file's duration (${formatSeconds(
        uploadedDurationSeconds,
      )}) doesn't match the YouTube video (${formatSeconds(
        ctx.youtubeDurationSeconds,
      )}). They differ by ${duration.differenceSeconds.toFixed(1)}s.`,
    }
  }

  return {
    uploadStatus: "ready",
    validationStatus: computeOverallValidationStatus(
      "passed",
      filenameValidationStatus,
    ),
    uploadedDurationSeconds: duration.uploadedDurationSeconds,
    durationDifferenceSeconds: duration.differenceSeconds,
    durationValidationStatus: "passed",
    filenameValidationStatus,
    filenameSimilarityScore,
    failureReason: null,
  }
}

function failed(
  reason: string,
  filenameValidationStatus: FilenameValidationStatus,
  filenameSimilarityScore: number | null,
): ValidationOutcome {
  return {
    uploadStatus: "failed",
    validationStatus: "failed",
    uploadedDurationSeconds: null,
    durationDifferenceSeconds: null,
    durationValidationStatus: null,
    filenameValidationStatus,
    filenameSimilarityScore,
    failureReason: reason,
  }
}

function formatSeconds(total: number): string {
  const seconds = Math.round(total)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

// Loads the validation context for a source file using the service-role client.
// Joins through to the analysed video for the YouTube title + duration. Returns
// null when the row is gone.
async function loadValidationContext(
  admin: SupabaseClient,
  sourceFileId: string,
): Promise<ValidationContext | null> {
  const { data, error } = await admin
    .from("source_files")
    .select(
      "id, storage_path, original_filename, youtube_duration_seconds, analysed_videos(video_title, video_details)",
    )
    .eq("id", sourceFileId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load source file for validation: ${error.message}`)
  }
  if (!data) return null

  const row = data as unknown as {
    id: string
    storage_path: string | null
    original_filename: string
    youtube_duration_seconds: number | null
    analysed_videos: {
      video_title: string | null
      video_details: { durationSeconds?: number } | null
    } | null
  }

  // Prefer the duration captured on the source file; fall back to the live
  // analysed-video details so older rows still validate.
  const youtubeDurationSeconds =
    row.youtube_duration_seconds ??
    row.analysed_videos?.video_details?.durationSeconds ??
    0

  return {
    sourceFileId: row.id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    youtubeDurationSeconds,
    videoTitle: row.analysed_videos?.video_title ?? "",
  }
}

// Production entry point. Loads the source file, marks it "processing", runs the
// validation decision and persists the outcome. Safe to call from a request
// handler today or a background worker later — it owns its own admin client.
export async function validateSourceFile(sourceFileId: string): Promise<void> {
  const admin = createAdminClient()

  const ctx = await loadValidationContext(admin, sourceFileId)
  if (!ctx) {
    // Nothing to validate — the row was deleted between upload and validation.
    return
  }

  await admin
    .from("source_files")
    .update({ upload_status: "processing", validation_status: "pending" })
    .eq("id", sourceFileId)

  let outcome: ValidationOutcome
  try {
    outcome = await computeValidationOutcome(ctx, defaultValidationDeps())
  } catch (error) {
    // Any unexpected failure leaves the file in a failed-but-recoverable state
    // so the user can retry, rather than stuck "processing" forever.
    console.error("Source file validation crashed", error)
    outcome = failed(
      "Validation failed unexpectedly. Please try re-uploading.",
      "unknown",
      null,
    )
  }

  const { error } = await admin
    .from("source_files")
    .update({
      upload_status: outcome.uploadStatus,
      validation_status: outcome.validationStatus,
      uploaded_duration_seconds: outcome.uploadedDurationSeconds,
      duration_difference_seconds: outcome.durationDifferenceSeconds,
      duration_validation_status: outcome.durationValidationStatus,
      filename_validation_status: outcome.filenameValidationStatus,
      filename_similarity_score: outcome.filenameSimilarityScore,
      failure_reason: outcome.failureReason,
    })
    .eq("id", sourceFileId)

  if (error) {
    throw new Error(`Failed to persist validation result: ${error.message}`)
  }
}
