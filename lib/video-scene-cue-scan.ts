// Runs the full-video scene-cue scan (cuts/freezes/black-frames — see
// lib/media/scene-detection.ts) for one analysed video, once its source file
// is readable. Independent of retention-window media extraction: this scans
// the whole video exactly once, not per window, gated by its own
// scene_cue_scan_status claim (lib/video-scene-cues.ts) so two overlapping
// triggers can't both pay for the same full-video decode.

import type { SupabaseClient } from "@supabase/supabase-js"

import { scanVideoSceneCues } from "@/lib/media/scene-detection"
import { getSourceVideoReadUrlExpirySeconds } from "@/lib/retention-window-media-config"
import {
  resolvePlaybackStoragePath,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import {
  claimVideoForSceneCueScan,
  markSceneCueScanFailed,
  markSceneCueScanReady,
  replaceVideoSceneCues,
} from "@/lib/video-scene-cues"

// Best-effort: claims the scan, runs it, and records ready/failed. No-ops
// (without claiming or minting a signed URL) if another trigger already
// claimed or finished it, or if the video's duration isn't known yet.
export async function scanPendingVideoSceneCues(
  admin: SupabaseClient,
  sourceStorage: StorageProvider,
  sourceFile: SourceFile,
  durationSeconds: number | null,
): Promise<void> {
  const playbackPath = resolvePlaybackStoragePath(sourceFile)
  if (!playbackPath || durationSeconds == null || durationSeconds <= 0) return

  const claimed = await claimVideoForSceneCueScan(
    admin,
    sourceFile.userId,
    sourceFile.analysedVideoId,
  )
  if (!claimed) return

  try {
    const sourceUrl = await sourceStorage.createSignedReadUrl(
      playbackPath,
      getSourceVideoReadUrlExpirySeconds(),
    )
    const scan = await scanVideoSceneCues(sourceUrl, durationSeconds)
    await replaceVideoSceneCues(
      admin,
      sourceFile.userId,
      sourceFile.analysedVideoId,
      scan,
    )
    await markSceneCueScanReady(admin, sourceFile.userId, sourceFile.analysedVideoId)
  } catch (error) {
    console.error("Failed to scan video scene cues", error)
    await markSceneCueScanFailed(
      admin,
      sourceFile.userId,
      sourceFile.analysedVideoId,
      error instanceof Error ? error.message : "Failed to scan video scene cues",
    ).catch(() => {})
  }
}
