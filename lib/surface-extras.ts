import type { SupabaseClient } from "@supabase/supabase-js"

import type { PackagingAlignment } from "@/lib/packaging-alignment"
import { getOrGeneratePackagingAlignment } from "@/lib/packaging-alignments"
import type { RetentionAttribution } from "@/lib/retention-attribution"
import { getOrGenerateRetentionAttribution } from "@/lib/retention-attributions"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"
import { getOrGenerateScriptTaxonomy } from "@/lib/script-taxonomies"
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
//
// `onSettled` is called as each task lands (settled, not necessarily
// successful), so /api/analyze can stream real progress through what is
// otherwise the longest silent stretch of a fresh analysis - three LLM calls in
// parallel. It's fire-and-forget: a throwing reporter must not fail the extras.
export async function loadSurfaceExtras(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: VideoDetails,
  retentionWindows: RetentionWindow[],
  transcript: TranscriptCue[],
  onSettled?: (completed: number, total: number) => void,
): Promise<{
  retentionAttribution: RetentionAttribution | null
  packagingAlignment: PackagingAlignment | null
  scriptTaxonomy: ScriptTaxonomy | null
  analyticsSummary: VideoAnalyticsSummary | null
}> {
  let settled = 0
  const total = 4
  const report = <T,>(task: Promise<T>): Promise<T> =>
    task.finally(() => {
      settled += 1
      try {
        onSettled?.(settled, total)
      } catch (reportError) {
        console.error("Failed to report surface-extras progress", reportError)
      }
    })

  const [
    retentionAttribution,
    packagingAlignment,
    scriptTaxonomy,
    analyticsSummary,
  ] = await Promise.all([
    report(
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
    ),
    report(
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
    ),
    report(
      getOrGenerateScriptTaxonomy(
        supabase,
        userId,
        analysedVideoId,
        video,
        transcript,
      ).catch((error) => {
        console.error("Failed to generate script taxonomy", error)
        return null
      }),
    ),
    report(
      getOrBackfillVideoAnalyticsSummary(
        supabase,
        userId,
        analysedVideoId,
        video,
      ),
    ),
  ])

  return {
    retentionAttribution,
    packagingAlignment,
    scriptTaxonomy,
    analyticsSummary,
  }
}
