// Best-effort kickoff for retention-window media extraction, immediately
// followed by AI analysis of whatever extraction just finished, immediately
// followed by cross-modal event synthesis for whichever windows' evidence
// just finished settling. Called from whichever of the two independent async
// processes finishes second for a given video:
//   • /api/analyze, right after the retention windows (and their pending
//     audio/scene-cue-scan/event-synthesis rows) are saved — the source
//     video may already be uploaded and normalised by then.
//   • the Qencode normalisation callback, right after a source file's proxy
//     flips to 'ready' — the retention analysis may already have run.
// Either caller no-ops if its half of the picture isn't ready yet; the other
// caller picks it up once it is.
//
// Runs via Next's after() so it happens once the response has been sent,
// never adding extraction latency to the request/webhook it's triggered from.
// None of extractPendingRetentionWindowMedia, analyzeRetentionWindowMedia, or
// synthesizeRetentionWindowEvents throws on its own (each row's/job's own
// failure is caught and recorded), but this is still wrapped defensively
// since after() callbacks that throw are logged as unhandled by the runtime.
// All three stay strictly sequential, in the same callback: analysis only
// claims rows extraction just marked 'ready', and synthesis only processes
// windows whose scan/snapshot/audio analysis just settled in the analysis
// step right before it.

import { after } from "next/server"

import { analyzeRetentionWindowMedia } from "@/lib/retention-window-media-analysis"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
} from "@/lib/retention-window-media-extraction"
import type { SourceFile } from "@/lib/source-files/source-files"
import { synthesizeRetentionWindowEvents } from "@/lib/retention-window-event-synthesis"

export function triggerRetentionWindowMediaExtraction(
  sourceFile: SourceFile | null,
): void {
  if (!isSourceFileReady(sourceFile)) return

  after(async () => {
    const admin = createAdminClient()
    const file = sourceFile as SourceFile

    try {
      await extractPendingRetentionWindowMedia(
        admin,
        getStorageProvider(),
        file,
      )
    } catch (error) {
      console.error("Failed to run retention window media extraction", error)
    }

    try {
      await analyzeRetentionWindowMedia(admin, file.userId, file.analysedVideoId)
    } catch (error) {
      console.error("Failed to run retention window media analysis", error)
    }

    try {
      await synthesizeRetentionWindowEvents(
        admin,
        file.userId,
        file.analysedVideoId,
      )
    } catch (error) {
      console.error("Failed to synthesize retention window events", error)
    }
  })
}
