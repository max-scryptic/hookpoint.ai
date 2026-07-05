import type { SupabaseClient } from "@supabase/supabase-js"

import type { PackagingAlignment } from "@/lib/packaging-alignment"
import { getOrGeneratePackagingAlignment } from "@/lib/packaging-alignments"
import type { RetentionAttribution } from "@/lib/retention-attribution"
import { getOrGenerateRetentionAttribution } from "@/lib/retention-attributions"
import type { RetentionWindow } from "@/lib/retention-windows"
import { getOrBackfillVideoAnalyticsSummary } from "@/lib/video-analytics"
import type {
  TranscriptCue,
  VideoAnalyticsSummary,
  VideoDetails,
} from "@/lib/youtube/youtube"

// Loads or generates the additive, surface-level reports that sit alongside
// the core retention analysis. Each task is independent and best-effort, so a
// missing optional report never prevents the core analysis from completing.
export async function loadSurfaceExtras(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: VideoDetails,
  retentionWindows: RetentionWindow[],
  transcript: TranscriptCue[],
): Promise<{
  retentionAttribution: RetentionAttribution | null
  packagingAlignment: PackagingAlignment | null
  analyticsSummary: VideoAnalyticsSummary | null
}> {
  const [retentionAttribution, packagingAlignment, analyticsSummary] =
    await Promise.all([
      getOrGenerateRetentionAttribution(
        supabase,
        userId,
        analysedVideoId,
        video,
        retentionWindows,
        transcript,
      ).catch((error) => {
        console.error("Failed to generate retention attribution", error)
        return null
      }),
      getOrGeneratePackagingAlignment(
        supabase,
        userId,
        analysedVideoId,
        video,
        transcript,
      ).catch((error) => {
        console.error("Failed to generate packaging alignment", error)
        return null
      }),
      getOrBackfillVideoAnalyticsSummary(
        supabase,
        userId,
        analysedVideoId,
        video,
      ),
    ])

  return { retentionAttribution, packagingAlignment, analyticsSummary }
}
