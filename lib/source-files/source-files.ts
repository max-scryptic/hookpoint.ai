// Read/write helpers for the `source_files` table — the metadata record for a
// raw video file a user uploads as the source of an analysed YouTube video.
//
// Two client styles are used intentionally:
//   • A user-scoped Supabase client (RLS-enforced) for anything driven directly
//     by a request, so a user can only ever touch their own rows.
//   • The service-role admin client for the validation service, which runs
//     "as the system" after ownership has already been established, and needs to
//     write validation results regardless of request context (think worker).

import type { SupabaseClient } from "@supabase/supabase-js"

export type DurationValidationStatus = "passed" | "failed"
export type FilenameValidationStatus = "passed" | "warning" | "unknown"
export type ValidationStatus = "pending" | "passed" | "warning" | "failed"
export type UploadStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed"
export type NormalisationStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "skipped"

export interface SourceFile {
  id: string
  userId: string
  analysedVideoId: string
  youtubeVideoId: string
  originalFilename: string
  storageProvider: string
  storagePath: string | null
  fileSizeBytes: number | null
  mimeType: string | null
  uploadedDurationSeconds: number | null
  youtubeDurationSeconds: number | null
  durationDifferenceSeconds: number | null
  durationValidationStatus: DurationValidationStatus | null
  filenameValidationStatus: FilenameValidationStatus | null
  filenameSimilarityScore: number | null
  validationStatus: ValidationStatus
  uploadStatus: UploadStatus
  failureReason: string | null
  deleteAfter: string | null
  // --- Normalisation (1080p proxy transcode) ---
  proxyStoragePath: string | null
  proxySizeBytes: number | null
  normalisationStatus: NormalisationStatus
  normalisationProvider: string | null
  normalisationTaskToken: string | null
  normalisationError: string | null
  originalDeletedAt: string | null
  createdAt: string
  updatedAt: string
}

interface SourceFileRow {
  id: string
  user_id: string
  analysed_video_id: string
  youtube_video_id: string
  original_filename: string
  storage_provider: string
  storage_path: string | null
  file_size_bytes: number | null
  mime_type: string | null
  uploaded_duration_seconds: number | null
  youtube_duration_seconds: number | null
  duration_difference_seconds: number | null
  duration_validation_status: DurationValidationStatus | null
  filename_validation_status: FilenameValidationStatus | null
  filename_similarity_score: number | null
  validation_status: ValidationStatus
  upload_status: UploadStatus
  failure_reason: string | null
  delete_after: string | null
  proxy_storage_path: string | null
  proxy_size_bytes: number | null
  normalisation_status: NormalisationStatus
  normalisation_provider: string | null
  normalisation_task_token: string | null
  normalisation_error: string | null
  original_deleted_at: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  "id, user_id, analysed_video_id, youtube_video_id, original_filename, storage_provider, storage_path, file_size_bytes, mime_type, uploaded_duration_seconds, youtube_duration_seconds, duration_difference_seconds, duration_validation_status, filename_validation_status, filename_similarity_score, validation_status, upload_status, failure_reason, delete_after, proxy_storage_path, proxy_size_bytes, normalisation_status, normalisation_provider, normalisation_task_token, normalisation_error, original_deleted_at, created_at, updated_at"

export function mapSourceFileRow(row: SourceFileRow): SourceFile {
  return {
    id: row.id,
    userId: row.user_id,
    analysedVideoId: row.analysed_video_id,
    youtubeVideoId: row.youtube_video_id,
    originalFilename: row.original_filename,
    storageProvider: row.storage_provider,
    storagePath: row.storage_path,
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
    uploadedDurationSeconds: row.uploaded_duration_seconds,
    youtubeDurationSeconds: row.youtube_duration_seconds,
    durationDifferenceSeconds: row.duration_difference_seconds,
    durationValidationStatus: row.duration_validation_status,
    filenameValidationStatus: row.filename_validation_status,
    filenameSimilarityScore: row.filename_similarity_score,
    validationStatus: row.validation_status,
    uploadStatus: row.upload_status,
    failureReason: row.failure_reason,
    deleteAfter: row.delete_after,
    proxyStoragePath: row.proxy_storage_path,
    proxySizeBytes: row.proxy_size_bytes,
    normalisationStatus: row.normalisation_status,
    normalisationProvider: row.normalisation_provider,
    normalisationTaskToken: row.normalisation_task_token,
    normalisationError: row.normalisation_error,
    originalDeletedAt: row.original_deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// The object key playback and frame extraction should read: the normalised 1080p
// proxy once normalisation has completed, falling back to the original master
// while the transcode is still pending/processing/failed (or disabled). The
// proxy path is only consulted at 'ready' so a job in flight (which records the
// planned proxy path up front) never points readers at a not-yet-written object.
// This keeps the source video playable at every stage.
export function resolvePlaybackStoragePath(
  sourceFile: Pick<
    SourceFile,
    "proxyStoragePath" | "storagePath" | "normalisationStatus"
  >,
): string | null {
  if (sourceFile.normalisationStatus === "ready" && sourceFile.proxyStoragePath) {
    return sourceFile.proxyStoragePath
  }
  return sourceFile.storagePath
}

export interface CreateSourceFileInput {
  userId: string
  analysedVideoId: string
  youtubeVideoId: string
  originalFilename: string
  mimeType: string | null
  storageProvider: string
  youtubeDurationSeconds: number
}

// Inserts a fresh source-file record in the "pending" upload state. Goes through
// the user-scoped client so RLS confirms the analysed video belongs to the user.
export async function createSourceFile(
  supabase: SupabaseClient,
  input: CreateSourceFileInput,
): Promise<SourceFile> {
  const { data, error } = await supabase
    .from("source_files")
    .insert({
      user_id: input.userId,
      analysed_video_id: input.analysedVideoId,
      youtube_video_id: input.youtubeVideoId,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      storage_provider: input.storageProvider,
      youtube_duration_seconds: input.youtubeDurationSeconds,
      upload_status: "pending",
      validation_status: "pending",
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to create source file: ${error.message}`)
  }

  return mapSourceFileRow(data as SourceFileRow)
}

// Replaces any existing source file for an analysed video with a fresh pending
// record (the table allows one per analysed video). Returns the old storage path
// so the caller can clean up the orphaned object. Used for re-upload/retry.
export async function replaceSourceFile(
  supabase: SupabaseClient,
  input: CreateSourceFileInput,
): Promise<{
  sourceFile: SourceFile
  previousStoragePath: string | null
  previousProxyStoragePath: string | null
}> {
  const existing = await getSourceFileForVideo(
    supabase,
    input.userId,
    input.youtubeVideoId,
  )

  if (existing) {
    const { error } = await supabase
      .from("source_files")
      .delete()
      .eq("id", existing.id)
      .eq("user_id", input.userId)
    if (error) {
      throw new Error(`Failed to clear existing source file: ${error.message}`)
    }
  }

  const sourceFile = await createSourceFile(supabase, input)
  return {
    sourceFile,
    previousStoragePath: existing?.storagePath ?? null,
    previousProxyStoragePath: existing?.proxyStoragePath ?? null,
  }
}

// Fetches a single source file by id, scoped to the owner. Returns null when it
// doesn't exist or belongs to another user (RLS makes the latter invisible).
export async function getSourceFileById(
  supabase: SupabaseClient,
  userId: string,
  sourceFileId: string,
): Promise<SourceFile | null> {
  const { data, error } = await supabase
    .from("source_files")
    .select(COLUMNS)
    .eq("id", sourceFileId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load source file: ${error.message}`)
  }

  return data ? mapSourceFileRow(data as SourceFileRow) : null
}

// Fetches the source file for a given YouTube video (one per video), scoped to
// the owner. Returns null when none has been uploaded.
export async function getSourceFileForVideo(
  supabase: SupabaseClient,
  userId: string,
  youtubeVideoId: string,
): Promise<SourceFile | null> {
  const { data, error } = await supabase
    .from("source_files")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("youtube_video_id", youtubeVideoId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load source file for video: ${error.message}`)
  }

  return data ? mapSourceFileRow(data as SourceFileRow) : null
}

// Finds a source file by its transcoder job id. Used by the normalisation status
// callback, which is an unauthenticated server-to-server request and therefore
// runs through the service-role admin client (RLS would otherwise hide the row).
// Returns null when no row carries that token (e.g. a stale/duplicate callback).
export async function getSourceFileByNormalisationTaskToken(
  supabase: SupabaseClient,
  taskToken: string,
): Promise<SourceFile | null> {
  const { data, error } = await supabase
    .from("source_files")
    .select(COLUMNS)
    .eq("normalisation_task_token", taskToken)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load source file by task token: ${error.message}`,
    )
  }

  return data ? mapSourceFileRow(data as SourceFileRow) : null
}

// Partial update mapped from camelCase fields to snake_case columns. Only the
// provided fields are written.
export interface UpdateSourceFileInput {
  storagePath?: string | null
  fileSizeBytes?: number | null
  mimeType?: string | null
  uploadedDurationSeconds?: number | null
  youtubeDurationSeconds?: number | null
  durationDifferenceSeconds?: number | null
  durationValidationStatus?: DurationValidationStatus | null
  filenameValidationStatus?: FilenameValidationStatus | null
  filenameSimilarityScore?: number | null
  validationStatus?: ValidationStatus
  uploadStatus?: UploadStatus
  failureReason?: string | null
  deleteAfter?: string | null
  proxyStoragePath?: string | null
  proxySizeBytes?: number | null
  normalisationStatus?: NormalisationStatus
  normalisationProvider?: string | null
  normalisationTaskToken?: string | null
  normalisationError?: string | null
  originalDeletedAt?: string | null
}

function toRow(input: UpdateSourceFileInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ("storagePath" in input) row.storage_path = input.storagePath
  if ("fileSizeBytes" in input) row.file_size_bytes = input.fileSizeBytes
  if ("mimeType" in input) row.mime_type = input.mimeType
  if ("uploadedDurationSeconds" in input)
    row.uploaded_duration_seconds = input.uploadedDurationSeconds
  if ("youtubeDurationSeconds" in input)
    row.youtube_duration_seconds = input.youtubeDurationSeconds
  if ("durationDifferenceSeconds" in input)
    row.duration_difference_seconds = input.durationDifferenceSeconds
  if ("durationValidationStatus" in input)
    row.duration_validation_status = input.durationValidationStatus
  if ("filenameValidationStatus" in input)
    row.filename_validation_status = input.filenameValidationStatus
  if ("filenameSimilarityScore" in input)
    row.filename_similarity_score = input.filenameSimilarityScore
  if ("validationStatus" in input) row.validation_status = input.validationStatus
  if ("uploadStatus" in input) row.upload_status = input.uploadStatus
  if ("failureReason" in input) row.failure_reason = input.failureReason
  if ("deleteAfter" in input) row.delete_after = input.deleteAfter
  if ("proxyStoragePath" in input) row.proxy_storage_path = input.proxyStoragePath
  if ("proxySizeBytes" in input) row.proxy_size_bytes = input.proxySizeBytes
  if ("normalisationStatus" in input)
    row.normalisation_status = input.normalisationStatus
  if ("normalisationProvider" in input)
    row.normalisation_provider = input.normalisationProvider
  if ("normalisationTaskToken" in input)
    row.normalisation_task_token = input.normalisationTaskToken
  if ("normalisationError" in input)
    row.normalisation_error = input.normalisationError
  if ("originalDeletedAt" in input)
    row.original_deleted_at = input.originalDeletedAt
  return row
}

// Updates a source file, scoped to its owner.
export async function updateSourceFile(
  supabase: SupabaseClient,
  userId: string,
  sourceFileId: string,
  input: UpdateSourceFileInput,
): Promise<SourceFile> {
  const { data, error } = await supabase
    .from("source_files")
    .update(toRow(input))
    .eq("id", sourceFileId)
    .eq("user_id", userId)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to update source file: ${error.message}`)
  }

  return mapSourceFileRow(data as SourceFileRow)
}

// Deletes a source file row, scoped to its owner. Returns the deleted row's
// storage path (if any) so the caller can remove the object.
export async function deleteSourceFileRow(
  supabase: SupabaseClient,
  userId: string,
  sourceFileId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("source_files")
    .delete()
    .eq("id", sourceFileId)
    .eq("user_id", userId)
    .select("storage_path")
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to delete source file: ${error.message}`)
  }

  return (data as { storage_path: string | null } | null)?.storage_path ?? null
}
