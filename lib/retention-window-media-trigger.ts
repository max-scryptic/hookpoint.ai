// Best-effort kickoff for retention-window media extraction. Called from
// whichever of the two independent async processes finishes second for a
// given video:
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
// extractPendingRetentionWindowMedia itself never throws (each row's own
// failure is caught and recorded), but this is still wrapped defensively since
// after() callbacks that throw are logged as unhandled by the runtime.

import { after } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
} from "@/lib/retention-window-media-extraction"
import type { SourceFile } from "@/lib/source-files/source-files"

export function triggerRetentionWindowMediaExtraction(
  sourceFile: SourceFile | null,
): void {
  if (!isSourceFileReady(sourceFile)) return

  after(async () => {
    try {
      await extractPendingRetentionWindowMedia(
        createAdminClient(),
        getStorageProvider(),
        sourceFile as SourceFile,
      )
    } catch (error) {
      console.error("Failed to run retention window media extraction", error)
    }
  })
}
