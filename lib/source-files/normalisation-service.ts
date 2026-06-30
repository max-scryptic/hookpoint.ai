// Orchestrates turning a validated original upload into a 1080p proxy and then
// dropping the original, using Qencode as the transcode worker.
//
// Two halves, mirroring the upload service:
//   • startNormalisation   - runs in the complete-upload request once the file
//     validates. Hands Qencode a signed read URL of the original + an S3
//     destination in our bucket, and records the job token. Best-effort: a
//     Qencode hiccup never fails the upload — the original stays as the
//     fallback and the row is marked 'failed' for a later retry.
//   • handleNormalisationCallback - runs in the (unauthenticated) Qencode status
//     webhook. On success it verifies the proxy landed, flips the row to
//     'ready', and deletes the original master. On error it records the failure
//     and keeps the original.
//
// The feature is fully gated by isNormalisationEnabled(): when Qencode/S3 aren't
// configured, startNormalisation is a no-op and the flow is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js"

import { QencodeClient, type QencodeQuery } from "@/lib/qencode/qencode"
import {
  buildQencodeDestination,
  getNormalisationCallbackUrl,
  getNormalisationSourceExpirySeconds,
  getProxyFormatOverrides,
  getProxyTargetHeight,
  getQencodeApiKey,
  getQencodeBaseUrl,
  isNormalisationEnabled,
} from "@/lib/source-files/normalisation-config"
import {
  updateSourceFile,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"

const NORMALISATION_PROVIDER = "qencode"

// Injectable seam so tests can supply a fake transcoder client. Defaults build a
// real Qencode client from env config.
export interface NormalisationDeps {
  createClient: () => QencodeClient
}

export function defaultNormalisationDeps(): NormalisationDeps {
  return {
    createClient: () =>
      new QencodeClient({
        apiKey: getQencodeApiKey() ?? "",
        baseUrl: getQencodeBaseUrl(),
      }),
  }
}

// Derives the proxy's object key from the original's: same per-upload folder,
// fixed leaf name tagged with the target height. Deterministic so kickoff and
// callback agree on the path without persisting extra state.
export function buildProxyObjectPath(
  originalPath: string,
  targetHeight: number,
): string {
  const slash = originalPath.lastIndexOf("/")
  const dir = slash === -1 ? "" : originalPath.slice(0, slash + 1)
  return `${dir}proxy-${targetHeight}p.mp4`
}

// Kicks off the 1080p transcode for a validated source file. Returns the source
// file, updated with the in-flight normalisation state when a job was started,
// or unchanged when normalisation is disabled or can't run. Never throws on a
// transcoder failure — it records 'failed' and returns so the upload completes.
export async function startNormalisation(
  supabase: SupabaseClient,
  storage: StorageProvider,
  sourceFile: SourceFile,
  deps: NormalisationDeps = defaultNormalisationDeps(),
): Promise<SourceFile> {
  // Disabled (no Qencode/S3/callback configured): leave the row untouched so the
  // original is kept and served, exactly as before this feature existed.
  if (!isNormalisationEnabled() || !sourceFile.storagePath) {
    return sourceFile
  }

  const targetHeight = getProxyTargetHeight()
  const proxyPath = buildProxyObjectPath(sourceFile.storagePath, targetHeight)

  try {
    const sourceUrl = await storage.createSignedReadUrl(
      sourceFile.storagePath,
      getNormalisationSourceExpirySeconds(),
    )

    const query: QencodeQuery = {
      source: sourceUrl,
      format: [
        {
          output: "mp4",
          video_codec: "libx264",
          height: targetHeight,
          ...getProxyFormatOverrides(),
          destination: buildQencodeDestination(proxyPath),
        },
      ],
      callback_url: getNormalisationCallbackUrl() ?? undefined,
    }

    const taskToken = await deps.createClient().submitJob(query)

    return updateSourceFile(supabase, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "processing",
      normalisationProvider: NORMALISATION_PROVIDER,
      normalisationTaskToken: taskToken,
      // Recorded now but only consulted by playback once the status is 'ready',
      // so it never points readers at a not-yet-written object.
      proxyStoragePath: proxyPath,
      normalisationError: null,
    })
  } catch (error) {
    console.error("Failed to start source-file normalisation", error)
    // Keep the original as the usable fallback; record the failure for retry.
    return updateSourceFile(supabase, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationProvider: NORMALISATION_PROVIDER,
      normalisationError:
        error instanceof Error ? error.message : "Failed to start normalisation",
    }).catch(() => sourceFile)
  }
}

// The minimal, provider-agnostic view of a transcoder status callback.
export interface NormalisationCallback {
  taskToken: string
  // 'completed' = proxy saved; 'error' = transcode failed; 'progress' = an
  // interim event we acknowledge but don't act on.
  outcome: "completed" | "error" | "progress"
  errorMessage?: string
}

// Parses a raw Qencode callback body into our normalised shape, or null when it
// doesn't carry a task token we can act on. Tolerant of field-name variation
// across Qencode events (task_token, event/status, error/message).
export function parseQencodeCallback(
  body: unknown,
): NormalisationCallback | null {
  if (typeof body !== "object" || body === null) return null
  const b = body as Record<string, unknown>

  const taskToken =
    typeof b.task_token === "string"
      ? b.task_token
      : typeof b.task_id === "string"
        ? b.task_id
        : null
  if (!taskToken) return null

  const event = String(b.event ?? b.status ?? "").toLowerCase()
  const errorField = Number(b.error ?? 0)

  let outcome: NormalisationCallback["outcome"] = "progress"
  if (event === "error" || errorField !== 0) {
    outcome = "error"
  } else if (event === "completed" || event === "saved") {
    outcome = "completed"
  }

  const errorMessage =
    typeof b.message === "string"
      ? b.message
      : typeof b.error_description === "string"
        ? b.error_description
        : undefined

  return { taskToken, outcome, errorMessage }
}

// Applies a parsed callback to the matching source file. On completion it
// verifies the proxy object exists, marks the row 'ready', then deletes the
// original master (best-effort). On error it records 'failed' and keeps the
// original. Idempotent: a duplicate completion for an already-ready row no-ops.
// Uses the service-role admin client (the callback is unauthenticated).
export async function applyNormalisationCallback(
  admin: SupabaseClient,
  storage: StorageProvider,
  sourceFile: SourceFile,
  callback: NormalisationCallback,
): Promise<void> {
  // Nothing to do for interim progress events or an already-finished row.
  if (callback.outcome === "progress") return
  if (sourceFile.normalisationStatus === "ready") return

  if (callback.outcome === "error") {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: callback.errorMessage ?? "Transcode failed",
    })
    return
  }

  // outcome === "completed": confirm the proxy actually landed before we commit
  // to deleting the original. A missing proxy is treated as a failure.
  const proxyPath = sourceFile.proxyStoragePath
  if (!proxyPath) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: "Completed callback had no proxy path on record",
    })
    return
  }

  const info = await storage.statObject(proxyPath)
  if (!info.exists) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: "Transcoder reported success but no proxy was found",
    })
    return
  }

  const originalPath = sourceFile.storagePath
  await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
    normalisationStatus: "ready",
    proxySizeBytes: info.sizeBytes,
    originalDeletedAt: new Date().toISOString(),
    // Drop the pointer to the original now that the proxy is the live file.
    storagePath: null,
    normalisationError: null,
  })

  // Delete the (large) original master last, best-effort: the proxy is already
  // the source of truth, so an orphaned original is a cost nit, not a bug.
  if (originalPath) {
    try {
      await storage.deleteObject(originalPath)
    } catch (error) {
      console.error("Failed to delete original after normalisation", error)
    }
  }
}
