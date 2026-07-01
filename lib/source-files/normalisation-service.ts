// Orchestrates turning a validated original upload into a 1080p proxy and then
// dropping the original, using Qencode as the transcode worker.
//
// Two halves, mirroring the upload service:
//   • startNormalisation   - runs in the complete-upload request once the file
//     validates. Hands Qencode a signed read URL of the original and records
//     the job token. Best-effort: a Qencode hiccup never fails the upload —
//     the original stays as the fallback and the row is marked 'failed' for a
//     later retry.
//   • applyNormalisationCallback - runs in the (unauthenticated) Qencode status
//     webhook. On success it pulls the finished proxy from the URL Qencode
//     hands back into our own bucket, flips the row to 'ready', and deletes the
//     original master. On error it records the failure and keeps the original.
//
// Qencode is deliberately not given a destination to write the proxy to
// directly: that was tried first, and Qencode's generic S3 destination writer
// silently produced 0-byte objects against Supabase's S3-compatible endpoint
// while still reporting the job as completed. Pulling the file ourselves, with
// the same S3 client already used for uploads, avoids that failure mode.
//
// The feature is fully gated by isNormalisationEnabled(): when Qencode/S3 aren't
// configured, startNormalisation is a no-op and the flow is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js"

import { QencodeClient, type QencodeQuery } from "@/lib/qencode/qencode"
import {
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
  // 'completed' = a finished video is ready to pull; 'error' = transcode
  // failed; 'progress' = an interim event we acknowledge but don't act on.
  outcome: "completed" | "error" | "progress"
  errorMessage?: string
  // Temporary download URL for the finished proxy (Qencode holds it on its own
  // storage for 24h since no destination was configured). Only set when
  // outcome === "completed".
  videoUrl?: string
}

// Qencode POSTs callbacks as application/x-www-form-urlencoded fields, not
// JSON: `task_token`, `event` (e.g. "saved"), and a `status` field holding a
// JSON-encoded string with `error` (0/1) and, on success, a `videos` array
// carrying each output's download `url`. The route hands us the decoded form
// fields as plain strings; this stays tolerant of the alternate field names
// seen in Qencode's docs (task_id, top-level error/message) in case a given
// event doesn't follow the documented shape.
export function parseQencodeCallback(
  fields: Record<string, string>,
): NormalisationCallback | null {
  const taskToken = fields.task_token || fields.task_id || null
  if (!taskToken) return null

  const event = (fields.event ?? "").toLowerCase()

  let status: Record<string, unknown> = {}
  if (fields.status) {
    try {
      const parsed = JSON.parse(fields.status)
      if (parsed && typeof parsed === "object") status = parsed
    } catch {
      // Not JSON — fall through with an empty status object.
    }
  }

  const errorField = Number(status.error ?? fields.error ?? 0)

  let outcome: NormalisationCallback["outcome"] = "progress"
  if (event === "error" || errorField !== 0) {
    outcome = "error"
  } else if (event === "completed" || event === "saved") {
    outcome = "completed"
  }

  const errorMessage =
    typeof status.message === "string"
      ? status.message
      : typeof fields.message === "string"
        ? fields.message
        : undefined

  const videos = Array.isArray(status.videos) ? status.videos : []
  const firstVideo = videos[0] as Record<string, unknown> | undefined
  const videoUrl = typeof firstVideo?.url === "string" ? firstVideo.url : undefined

  return { taskToken, outcome, errorMessage, videoUrl }
}

// Applies a parsed callback to the matching source file. On completion it pulls
// the finished proxy from Qencode's temporary storage into our own bucket,
// verifies it landed with real content, marks the row 'ready', then deletes the
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

  // outcome === "completed": we need somewhere to write the proxy and a URL to
  // pull it from before we can commit to deleting the original.
  const proxyPath = sourceFile.proxyStoragePath
  if (!proxyPath || !callback.videoUrl) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: "Completed callback had no output to pull",
    })
    return
  }

  if (!storage.putObjectFromUrl) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: "Storage provider can't pull the transcoder output",
    })
    return
  }

  try {
    await storage.putObjectFromUrl(proxyPath, callback.videoUrl, {
      contentType: "video/mp4",
    })
  } catch (error) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError:
        error instanceof Error
          ? error.message
          : "Failed to pull transcoder output",
    })
    return
  }

  // A zero-byte object counts as missing: guards against a partial/broken pull
  // landing an empty file the same way Qencode's own direct writer once did.
  const info = await storage.statObject(proxyPath)
  if (!info.exists || !info.sizeBytes) {
    await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
      normalisationStatus: "failed",
      normalisationError: info.exists
        ? "Pulled proxy landed empty (0 bytes)"
        : "Pulled proxy is missing after upload",
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
