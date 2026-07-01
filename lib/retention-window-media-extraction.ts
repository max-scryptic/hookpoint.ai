// Runs the actual thumbnail/audio harvest for a video's pending
// retention_window_snapshots/retention_window_audio rows, once the source
// video is available. Triggered best-effort from whichever of the two async
// processes finishes second (see lib/retention-window-media-trigger.ts): the
// retention analysis, which computes the rows, or the source-file
// normalisation callback, which makes the video readable.
//
// Every row is processed independently and its own status updated as soon as
// it succeeds or fails, so a partial run (a timeout, a single bad seek) never
// strands the whole batch — rows left 'pending' just wait for the next trigger.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  defaultVideoExtractor,
  type VideoExtractor,
} from "@/lib/media/video-extraction"
import {
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

export interface RetentionWindowMediaExtractionDeps {
  extractor: VideoExtractor
  mediaStorage: StorageProvider
}

export function defaultRetentionWindowMediaExtractionDeps(): RetentionWindowMediaExtractionDeps {
  return {
    extractor: defaultVideoExtractor,
    mediaStorage: getRetentionWindowMediaStorageProvider(),
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

// Extracts every pending snapshot and audio row for one video. Best-effort per
// row — an ffmpeg failure is recorded on that row and the run continues. Never
// mints a signed read URL (or otherwise does any work) when nothing is pending.
export async function extractPendingRetentionWindowMedia(
  admin: SupabaseClient,
  sourceStorage: StorageProvider,
  sourceFile: SourceFile,
  deps: RetentionWindowMediaExtractionDeps = defaultRetentionWindowMediaExtractionDeps(),
): Promise<void> {
  const playbackPath = resolvePlaybackStoragePath(sourceFile)
  if (!playbackPath) return

  const [pendingSnapshots, pendingAudio] = await Promise.all([
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
  ])

  if (pendingSnapshots.length === 0 && pendingAudio.length === 0) return

  const sourceUrl = await sourceStorage.createSignedReadUrl(
    playbackPath,
    getSourceVideoReadUrlExpirySeconds(),
  )

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
      await updateRetentionWindowSnapshotStatus(
        admin,
        sourceFile.userId,
        snapshot.id,
        { status: "ready", storagePath: path },
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
