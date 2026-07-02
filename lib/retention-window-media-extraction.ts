// Runs the actual thumbnail/audio/scene-cue harvest for a video's pending
// retention_window_snapshots/retention_window_audio/
// retention_window_scene_cue_scans rows, once the source video is available.
// Each harvested snapshot also gets deterministic (no LLM) OCR run on it
// inline, right after extraction, using the JPEG bytes already in hand — see
// lib/media/ocr.ts.
// Triggered best-effort from whichever of the two async processes finishes
// second (see lib/retention-window-media-trigger.ts): the retention analysis,
// which computes the rows, or the source-file normalisation callback, which
// makes the video readable.
//
// Every row is processed independently and its own status updated as soon as
// it succeeds or fails, so a partial run (a timeout, a single bad seek) never
// strands the whole batch — rows left 'pending' just wait for the next trigger.
//
// The scene-cue scan is folded into this same pass (not a separate trigger)
// because it needs exactly the same signed source URL, over exactly the same
// per-window [from, to] range, as the audio extraction below it — see
// lib/media/scene-detection.ts for why it's scoped to a window rather than a
// whole-video decode.
//
// Scene-cue scans run *before* snapshots, not after: a window's snapshot
// timestamps are now derived from its detected cuts (see
// buildSnapshotTimestampsFromSceneCues in lib/retention-window-media.ts) —
// flanking frames just before/after each real transition, instead of a blind
// fixed-interval grid — so those rows can't be created until the scan for
// that window has actually run. A scan that fails still creates snapshots
// (via the same fixed-grid fallback a zero-cut window gets), so a window is
// never left with no visual evidence just because ffmpeg errored once; see
// getPendingRetentionWindowSceneCueScans in lib/video-scene-cues.ts for how a
// failed scan itself gets retried.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  defaultVideoExtractor,
  type VideoExtractor,
} from "@/lib/media/video-extraction"
import {
  scanVideoSceneCues,
  type SceneCueScanResult,
} from "@/lib/media/scene-detection"
import { createOcrEngine, type OcrEngine } from "@/lib/media/ocr"
import {
  createRetentionWindowSnapshotsFromSceneCues,
  getPendingRetentionWindowAudio,
  getPendingRetentionWindowSnapshots,
  updateRetentionWindowAudioStatus,
  updateRetentionWindowSnapshotStatus,
} from "@/lib/retention-window-media"
import {
  buildRetentionAudioObjectPath,
  buildRetentionSnapshotObjectPath,
  getRetentionWindowMediaStorageProvider,
  getSourceVideoReadUrlExpirySeconds,
} from "@/lib/retention-window-media-config"
import {
  resolvePlaybackStoragePath,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import {
  getPendingRetentionWindowSceneCueScans,
  replaceRetentionWindowSceneCues,
  updateRetentionWindowSceneCueScanStatus,
} from "@/lib/video-scene-cues"

export interface SceneCueScanner {
  scan(
    sourceUrl: string,
    fromSeconds: number,
    toSeconds: number,
  ): Promise<SceneCueScanResult>
}

export interface RetentionWindowMediaExtractionDeps {
  extractor: VideoExtractor
  mediaStorage: StorageProvider
  sceneCueScanner: SceneCueScanner
  // A factory, not a shared instance: a fresh OCR engine (and the WASM
  // core/language-data load that comes with creating one) is created once
  // per extraction run, only if snapshots are actually pending, and
  // terminated at the end of that run.
  createOcrEngine: () => Promise<OcrEngine>
}

export function defaultRetentionWindowMediaExtractionDeps(): RetentionWindowMediaExtractionDeps {
  return {
    extractor: defaultVideoExtractor,
    mediaStorage: getRetentionWindowMediaStorageProvider(),
    sceneCueScanner: { scan: scanVideoSceneCues },
    createOcrEngine,
  }
}

// True when a source file is actually readable right now — the normalised
// proxy or the original master, whichever resolvePlaybackStoragePath resolves
// to. Extraction can run against either.
export function isSourceFileReady(sourceFile: SourceFile | null): boolean {
  return (
    sourceFile != null &&
    sourceFile.uploadStatus === "ready" &&
    resolvePlaybackStoragePath(sourceFile) != null
  )
}

// Extracts every pending snapshot, audio, and scene-cue-scan row for one
// video. Best-effort per row — an ffmpeg failure is recorded on that row and
// the run continues. Never mints a signed read URL (or otherwise does any
// work) when nothing is pending.
export async function extractPendingRetentionWindowMedia(
  admin: SupabaseClient,
  sourceStorage: StorageProvider,
  sourceFile: SourceFile,
  deps: RetentionWindowMediaExtractionDeps = defaultRetentionWindowMediaExtractionDeps(),
): Promise<void> {
  const playbackPath = resolvePlaybackStoragePath(sourceFile)
  if (!playbackPath) return

  const [initialPendingSnapshots, pendingAudio, pendingSceneCueScans] =
    await Promise.all([
      getPendingRetentionWindowSnapshots(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
      getPendingRetentionWindowAudio(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
      getPendingRetentionWindowSceneCueScans(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
    ])

  if (
    initialPendingSnapshots.length === 0 &&
    pendingAudio.length === 0 &&
    pendingSceneCueScans.length === 0
  ) {
    return
  }

  const sourceUrl = await sourceStorage.createSignedReadUrl(
    playbackPath,
    getSourceVideoReadUrlExpirySeconds(),
  )

  for (const scan of pendingSceneCueScans) {
    // Snapshots still get derived and created below even when the scan
    // itself fails — from these empty cues, which is exactly the fallback a
    // window with genuinely zero detected cuts already gets (see
    // buildSnapshotTimestampsFromSceneCues). Without this, a single
    // transient ffmpeg failure (a network hiccup, a bad seek) would leave a
    // window with no visual evidence at all until the next full re-analyze.
    let cues: SceneCueScanResult = { cuts: [], freezes: [], blacks: [] }
    let scanError: string | null = null

    try {
      cues = await deps.sceneCueScanner.scan(
        sourceUrl,
        scan.fromSeconds,
        scan.toSeconds,
      )
      await replaceRetentionWindowSceneCues(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
        scan.retentionWindowId,
        cues,
      )
    } catch (error) {
      console.error("Failed to scan retention window scene cues", error)
      scanError =
        error instanceof Error ? error.message : "Failed to scan scene cues"
    }

    try {
      await createRetentionWindowSnapshotsFromSceneCues(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
        scan.retentionWindowId,
        scan.fromSeconds,
        scan.toSeconds,
        cues,
      )
      // The scan's own status still faithfully reports failure when the
      // ffmpeg call itself errored — snapshots existing doesn't mean cut
      // detection actually ran for this window, and a failed scan is what
      // makes it eligible for retry (see getPendingRetentionWindowSceneCueScans).
      await updateRetentionWindowSceneCueScanStatus(
        admin,
        sourceFile.userId,
        scan.id,
        scanError ? { status: "failed", error: scanError } : { status: "ready" },
      )
    } catch (error) {
      console.error(
        "Failed to save retention window snapshots derived from scene cues",
        error,
      )
      await updateRetentionWindowSceneCueScanStatus(
        admin,
        sourceFile.userId,
        scan.id,
        {
          status: "failed",
          error:
            scanError ??
            (error instanceof Error
              ? error.message
              : "Failed to save snapshots"),
        },
      ).catch(() => {})
    }
  }

  // Re-read pending snapshots after the scan loop above: it may have just
  // created fresh rows (derived from cues) for whichever windows it scanned,
  // which the earlier read couldn't have seen yet.
  const pendingSnapshots =
    pendingSceneCueScans.length > 0
      ? await getPendingRetentionWindowSnapshots(
          admin,
          sourceFile.userId,
          sourceFile.analysedVideoId,
        )
      : initialPendingSnapshots

  // One OCR engine (the WASM core + trained language data load) for every
  // snapshot in this run, not one per snapshot — recreating it per frame
  // would pay that load cost repeatedly for no benefit.
  const ocrEngine =
    pendingSnapshots.length > 0 ? await deps.createOcrEngine() : null

  try {
    for (const snapshot of pendingSnapshots) {
      try {
        const jpeg = await deps.extractor.extractThumbnail(
          sourceUrl,
          snapshot.timestampSeconds,
        )
        const path = buildRetentionSnapshotObjectPath({
          userId: sourceFile.userId,
          analysedVideoId: sourceFile.analysedVideoId,
          retentionWindowId: snapshot.retentionWindowId,
          chunkIndex: snapshot.chunkIndex,
        })
        await deps.mediaStorage.putObject(path, jpeg, {
          contentType: "image/jpeg",
        })
        // Deterministic OCR is best-effort: a recognition failure shouldn't
        // fail the whole row, since the JPEG itself extracted fine — just
        // leave ocrText null, the same tolerance ffmpeg's own volumedetect/
        // silencedetect measurements already get on the audio side.
        const ocrText = ocrEngine
          ? await ocrEngine
              .recognize(jpeg)
              .then((result) => result.text)
              .catch((error) => {
                console.error("Failed to OCR retention window snapshot", error)
                return null
              })
          : null
        await updateRetentionWindowSnapshotStatus(
          admin,
          sourceFile.userId,
          snapshot.id,
          { status: "ready", storagePath: path, ocrText },
        )
      } catch (error) {
        console.error("Failed to extract retention window snapshot", error)
        await updateRetentionWindowSnapshotStatus(
          admin,
          sourceFile.userId,
          snapshot.id,
          {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Failed to extract thumbnail",
          },
        ).catch(() => {})
      }
    }
  } finally {
    await ocrEngine?.terminate().catch(() => {})
  }

  for (const audio of pendingAudio) {
    try {
      const clip = await deps.extractor.extractAudioSegment(
        sourceUrl,
        audio.fromSeconds,
        audio.toSeconds,
      )
      const path = buildRetentionAudioObjectPath({
        userId: sourceFile.userId,
        analysedVideoId: sourceFile.analysedVideoId,
        retentionWindowId: audio.retentionWindowId,
      })
      await deps.mediaStorage.putObject(path, clip, { contentType: "audio/aac" })
      await updateRetentionWindowAudioStatus(admin, sourceFile.userId, audio.id, {
        status: "ready",
        storagePath: path,
      })
    } catch (error) {
      console.error("Failed to extract retention window audio", error)
      await updateRetentionWindowAudioStatus(
        admin,
        sourceFile.userId,
        audio.id,
        {
          status: "failed",
          error:
            error instanceof Error ? error.message : "Failed to extract audio",
        },
      ).catch(() => {})
    }
  }
}
