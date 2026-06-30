// The validation service: given an uploaded source file and the duration the
// browser measured for it, compare that duration to the YouTube-reported
// duration, run the soft filename/title similarity check, and return the verdict.
//
// Duration is measured client-side — the browser already holds the file, so it
// can read the duration for free before/after upload — and passed in here. We no
// longer shell out to ffprobe over a signed URL. That keeps validation a fast,
// pure, synchronous computation that runs inline in the complete-upload request:
// there is no long-running step that can overrun the function's time budget and
// strand the record in a non-terminal "processing" state (the bug this replaces).
// The duration check is a soft "did you upload the right file?" guard for the
// user's own content, not a security boundary, so a client-measured value is
// sufficient.

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

// Everything the orchestrator needs to know about the file under validation.
export interface ValidationContext {
  originalFilename: string
  // YouTube-reported duration (seconds) captured from the analysed video.
  youtubeDurationSeconds: number
  // The YouTube video title, used for the soft filename similarity check.
  videoTitle: string
  // Duration (seconds) the browser measured for the uploaded file, or null when
  // it couldn't be read — e.g. an .mkv, which most browsers can't decode.
  uploadedDurationSeconds: number | null
}

// Injected thresholds. Defaults wire to the configured values; tests pass fakes.
export interface ValidationDeps {
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
    toleranceSeconds: getDurationToleranceSeconds(),
    filenameThreshold: getFilenameSimilarityThreshold(),
  }
}

// Runs the full validation decision for one source file. Pure: given the inputs
// it returns the outcome with no I/O, so every branch (duration unknown,
// mismatch, pass/warning) is directly testable and the whole thing can run
// synchronously inside the request that completes the upload.
export function computeValidationOutcome(
  ctx: ValidationContext,
  deps: ValidationDeps,
): ValidationOutcome {
  // The filename/title similarity is independent of the file bytes, so compute
  // it up front — it's reported even when the duration can't be checked.
  const filenameSimilarityScore = computeFilenameSimilarity(
    ctx.originalFilename,
    ctx.videoTitle,
  )
  const filenameValidationStatus = filenameStatusFromScore(
    filenameSimilarityScore,
    deps.filenameThreshold,
  )

  const uploadedDuration = ctx.uploadedDurationSeconds
  // We can't run the duration check when the browser couldn't measure the file
  // (e.g. .mkv) or when we have no reliable YouTube duration to compare against.
  // Don't block the user — accept the file but flag it so they can confirm it's
  // the right source.
  if (
    uploadedDuration == null ||
    !Number.isFinite(uploadedDuration) ||
    uploadedDuration <= 0 ||
    ctx.youtubeDurationSeconds <= 0
  ) {
    return {
      uploadStatus: "ready",
      validationStatus: "warning",
      uploadedDurationSeconds:
        uploadedDuration != null && Number.isFinite(uploadedDuration) && uploadedDuration > 0
          ? uploadedDuration
          : null,
      durationDifferenceSeconds: null,
      durationValidationStatus: null,
      filenameValidationStatus,
      filenameSimilarityScore,
      failureReason: null,
    }
  }

  const duration = compareDuration(
    uploadedDuration,
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
        uploadedDuration,
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

function formatSeconds(total: number): string {
  const seconds = Math.round(total)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}
