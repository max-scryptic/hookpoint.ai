// Orchestrates turning a validated original upload into a 720p proxy and then
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
  getAnalysisProxyTargetHeight,
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

// `tag` values set on each Qencode format so the completion callback can tell
// the outputs apart (Qencode echoes them back on each entry of the status
// payload's `videos` array) — more robust than relying on output order or on
// Qencode reporting a height per video.
const PLAYBACK_OUTPUT_TAG = "playback"
const ANALYSIS_OUTPUT_TAG = "analysis"

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

// Kicks off the 720p transcode for a validated source file. Returns the source
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
  // The 360p analysis proxy rides along in the same job as a second output.
  // Skipped when disabled (height 0) or when it wouldn't actually be smaller
  // than the playback proxy — a duplicate output would also collide on the
  // height-tagged object path.
  const analysisHeight = getAnalysisProxyTargetHeight()
  const wantAnalysisProxy = analysisHeight > 0 && analysisHeight < targetHeight
  const analysisProxyPath = wantAnalysisProxy
    ? buildProxyObjectPath(sourceFile.storagePath, analysisHeight)
    : null

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
          // Set on both fields: Qencode echoes our label back as `user_tag`
          // (its own value lands in the system `tag`), but set `tag` too so a
          // provider/account that echoes there instead is still matchable. See
          // pickCallbackVideo / parseQencodeCallback.
          tag: PLAYBACK_OUTPUT_TAG,
          user_tag: PLAYBACK_OUTPUT_TAG,
          ...getProxyFormatOverrides(),
        },
        ...(wantAnalysisProxy
          ? [
              {
                output: "mp4",
                video_codec: "libx264",
                height: analysisHeight,
                tag: ANALYSIS_OUTPUT_TAG,
                user_tag: ANALYSIS_OUTPUT_TAG,
              },
            ]
          : []),
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
      analysisProxyStoragePath: analysisProxyPath,
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

// One finished output in a transcoder status callback: its temporary download
// URL plus whatever identifying metadata the callback carried for it.
export interface NormalisationCallbackVideo {
  url: string
  // The `tag` we set on the format when submitting the job, echoed back by
  // Qencode (as `tag` or `user_tag`) — the reliable way to tell the playback
  // proxy from the analysis proxy. Null for a provider/event that dropped it.
  tag: string | null
  height: number | null
}

// The minimal, provider-agnostic view of a transcoder status callback.
export interface NormalisationCallback {
  taskToken: string
  // 'completed' = finished videos are ready to pull; 'error' = transcode
  // failed; 'progress' = an interim event we acknowledge but don't act on.
  outcome: "completed" | "error" | "progress"
  errorMessage?: string
  // Every finished output's temporary download URL (Qencode holds them on its
  // own storage for 24h since no destination was configured). Only populated
  // when outcome === "completed".
  videos: NormalisationCallbackVideo[]
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

  const rawVideos = Array.isArray(status.videos) ? status.videos : []
  const videos: NormalisationCallbackVideo[] = []
  for (const entry of rawVideos) {
    const video = entry as Record<string, unknown> | null
    if (!video || typeof video.url !== "string") continue
    // Prefer `user_tag` (the field Qencode echoes our submitted label into)
    // over `tag` (which Qencode overwrites with its own system value). Reading
    // them the other way round matched our label only when the system tag
    // happened to be absent, which is why the analysis proxy was never
    // identified — and pulled — on a real callback.
    const tag = video.user_tag ?? video.tag
    videos.push({
      url: video.url,
      tag: typeof tag === "string" ? tag : null,
      height: typeof video.height === "number" ? video.height : null,
    })
  }

  return { taskToken, outcome, errorMessage, videos }
}

// Picks one callback output by its format tag, with two ordered fallbacks for
// callbacks that dropped the tags: by height (playback is the tallest output,
// analysis the shortest), then — only when exactly the two outputs we asked
// for came back — by submission position (playback first, analysis second).
// With a single output it's the required playback proxy and there's no
// analysis proxy to report.
export function pickCallbackVideo(
  videos: NormalisationCallbackVideo[],
  which: typeof PLAYBACK_OUTPUT_TAG | typeof ANALYSIS_OUTPUT_TAG,
): NormalisationCallbackVideo | null {
  const tagged = videos.find((video) => video.tag === which)
  if (tagged) return tagged

  // No tags to go on. With a single output, assume it's the playback proxy —
  // the required one — and report no analysis proxy at all.
  if (videos.length <= 1) {
    return which === PLAYBACK_OUTPUT_TAG ? (videos[0] ?? null) : null
  }

  const withHeights = videos.filter((video) => video.height != null)
  if (withHeights.length === videos.length) {
    const sorted = [...withHeights].sort(
      (a, b) => (b.height as number) - (a.height as number),
    )
    return which === PLAYBACK_OUTPUT_TAG ? sorted[0] : sorted[sorted.length - 1]
  }

  // Heights missing too. We submit the formats in a fixed order (playback,
  // then analysis) and Qencode returns outputs in that order, so with exactly
  // the two we asked for, fall back to position. Guarded to exactly two: with
  // more (or fewer) outputs than expected we only trust the required playback
  // pick and leave the best-effort analysis proxy unresolved rather than risk
  // pulling the wrong file.
  if (videos.length === 2) {
    return which === PLAYBACK_OUTPUT_TAG ? videos[0] : videos[1]
  }
  return which === PLAYBACK_OUTPUT_TAG ? videos[0] : null
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
  const playbackVideo = pickCallbackVideo(callback.videos, PLAYBACK_OUTPUT_TAG)
  if (!proxyPath || !playbackVideo) {
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
    await storage.putObjectFromUrl(proxyPath, playbackVideo.url, {
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

  // The 360p analysis proxy is strictly best-effort: extraction falls back to
  // the playback proxy when it's absent, so a failed pull here must not fail
  // normalisation — it just clears the recorded path so nothing ever reads a
  // missing/empty object. Its absence used to be silent, which is how every
  // upload ended up decoding the 720p playback proxy unnoticed; log the
  // outcome (and, when absent, why) so the expensive fallback is visible.
  const analysisProxy = await pullAnalysisProxy(storage, sourceFile, callback)
  if (analysisProxy.ok) {
    console.info("Analysis proxy ready after normalisation", {
      analysedVideoId: sourceFile.analysedVideoId,
      sourceFileId: sourceFile.id,
      sizeBytes: analysisProxy.sizeBytes,
    })
  } else {
    console.warn(
      "No analysis proxy after normalisation — deep analysis will decode the 720p playback proxy",
      {
        analysedVideoId: sourceFile.analysedVideoId,
        sourceFileId: sourceFile.id,
        reason: analysisProxy.reason,
        callbackVideos: summariseCallbackVideos(callback.videos),
      },
    )
  }

  const originalPath = sourceFile.storagePath
  await updateSourceFile(admin, sourceFile.userId, sourceFile.id, {
    normalisationStatus: "ready",
    proxySizeBytes: info.sizeBytes,
    analysisProxyStoragePath: analysisProxy.ok ? analysisProxy.storagePath : null,
    analysisProxySizeBytes: analysisProxy.ok ? analysisProxy.sizeBytes : null,
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

// Why an analysis proxy didn't land, for the caller's diagnostic log. Each
// value names a distinct point the best-effort pull can bow out at, so a run
// of "no analysis proxy" warnings points straight at the cause (the job never
// requested it, Qencode returned only the playback output, the pull failed…)
// instead of being uniformly silent.
type AnalysisProxyAbsentReason =
  | "not-requested" // kickoff recorded no destination (the second output was disabled)
  | "no-output" // the callback carried no output we could identify as the analysis one
  | "provider-unsupported" // storage can't pull from a URL
  | "landed-empty" // pulled object was missing/0 bytes
  | "pull-failed" // the pull threw

type AnalysisProxyResult =
  | { ok: true; storagePath: string; sizeBytes: number }
  | { ok: false; reason: AnalysisProxyAbsentReason }

// Pulls the 360p analysis proxy into our bucket and verifies it landed with
// real content. Never throws: every failure path returns a reason so the
// caller can record "no analysis proxy" (and why) and move on — extraction
// falls back to the playback proxy regardless.
async function pullAnalysisProxy(
  storage: StorageProvider,
  sourceFile: SourceFile,
  callback: NormalisationCallback,
): Promise<AnalysisProxyResult> {
  const analysisPath = sourceFile.analysisProxyStoragePath
  if (!analysisPath) return { ok: false, reason: "not-requested" }
  const analysisVideo = pickCallbackVideo(callback.videos, ANALYSIS_OUTPUT_TAG)
  if (!analysisVideo) return { ok: false, reason: "no-output" }
  if (!storage.putObjectFromUrl) {
    return { ok: false, reason: "provider-unsupported" }
  }

  try {
    await storage.putObjectFromUrl(analysisPath, analysisVideo.url, {
      contentType: "video/mp4",
    })
    const info = await storage.statObject(analysisPath)
    if (!info.exists || !info.sizeBytes) return { ok: false, reason: "landed-empty" }
    return { ok: true, storagePath: analysisPath, sizeBytes: info.sizeBytes }
  } catch (error) {
    console.error("Failed to pull analysis proxy after normalisation", error)
    return { ok: false, reason: "pull-failed" }
  }
}

// Compact, log-safe view of a callback's outputs (no signed URLs) — the shape
// needed to tell why output matching picked what it did: how many outputs came
// back and each one's tag/height.
function summariseCallbackVideos(
  videos: NormalisationCallbackVideo[],
): { count: number; outputs: { tag: string | null; height: number | null }[] } {
  return {
    count: videos.length,
    outputs: videos.map((video) => ({ tag: video.tag, height: video.height })),
  }
}
