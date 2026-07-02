// Best-effort kickoff for retention-window media extraction, immediately
// followed by AI analysis of whatever extraction just finished, plus the
// independent full-video scene-cue scan (cuts/freezes/black-frames — see
// lib/video-scene-cue-scan.ts). Called from whichever of the two independent
// async processes finishes second for a given video:
//   • /api/analyze, right after the retention windows (and their pending
//     snapshot/audio rows) are saved — the source video may already be
//     uploaded and normalised by then.
//   • the Qencode normalisation callback, right after a source file's proxy
//     flips to 'ready' — the retention analysis may already have run.
// Either caller no-ops if its half of the picture isn't ready yet; the other
// caller picks it up once it is.
//
// Runs via Next's after() so it happens once the response has been sent,
// never adding extraction latency to the request/webhook it's triggered from.
// None of extractPendingRetentionWindowMedia, analyzeRetentionWindowMedia, or
// scanPendingVideoSceneCues throws on its own (each row's/video's own failure
// is caught and recorded), but this is still wrapped defensively since
// after() callbacks that throw are logged as unhandled by the runtime.
// Extraction and analysis stay sequential (analysis only claims rows
// extraction just marked 'ready'); the scene-cue scan doesn't depend on
// retention windows at all, so it runs concurrently with that pair rather
// than waiting behind it.

import { after } from "next/server"

import { analyzeRetentionWindowMedia } from "@/lib/retention-window-media-analysis"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
} from "@/lib/retention-window-media-extraction"
import type { SourceFile } from "@/lib/source-files/source-files"
import { scanPendingVideoSceneCues } from "@/lib/video-scene-cue-scan"

export function triggerRetentionWindowMediaExtraction(
  sourceFile: SourceFile | null,
): void {
  if (!isSourceFileReady(sourceFile)) return
  const file = sourceFile as SourceFile

  after(async () => {
    const admin = createAdminClient()
    const storage = getStorageProvider()

    const mediaPipeline = (async () => {
      try {
        await extractPendingRetentionWindowMedia(admin, storage, file)
      } catch (error) {
        console.error("Failed to run retention window media extraction", error)
      }

      try {
        await analyzeRetentionWindowMedia(admin, file.userId, file.analysedVideoId)
      } catch (error) {
        console.error("Failed to run retention window media analysis", error)
      }
    })()

    const sceneCueScan = scanPendingVideoSceneCues(
      admin,
      storage,
      file,
      file.uploadedDurationSeconds ?? file.youtubeDurationSeconds,
    ).catch((error) => {
      console.error("Failed to run video scene cue scan", error)
    })

    await Promise.all([mediaPipeline, sceneCueScan])
  })
}
