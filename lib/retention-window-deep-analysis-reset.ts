// Clears every row the deep-analysis pipeline (scene-cue scans, harvested
// snapshots/audio and their AI analysis, and synthesized events) has written
// for a video, while leaving `retention_windows` itself, transcripts, and
// everything light-analysis owns (analysed_videos, pacing) untouched — those
// are recomputed by /api/analyze, not by this pipeline. Used by the
// "retry deep analysis" flow (app/api/videos/[videoId]/retry-deep-analysis)
// to let a user re-run deep analysis from scratch without re-uploading their
// source file or re-fetching the retention curve.
//
// After clearing, recreates the pending audio/scene-cue-scan/event-synthesis
// job rows against the video's existing retention windows — mirroring what
// /api/analyze does right after saving a fresh set of windows — so the next
// call to triggerRetentionWindowMediaExtraction has work to pick up. Pending
// snapshot rows aren't recreated here: they're derived from each window's
// scene-cue scan during extraction, the same as a first run. The per-window
// transcript taxonomy lives on the transcripts row (which this reset keeps, as
// light analysis owns the text), so instead of deleting it we re-pend it in
// place — the same set of selected windows, prior reads cleared.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createPendingRetentionWindowAudio } from "@/lib/retention-window-media"
import { createPendingRetentionWindowSceneCueScans } from "@/lib/video-scene-cues"
import { createPendingRetentionWindowEventSynthesis } from "@/lib/retention-window-events"
import { rependRetentionWindowTranscriptTaxonomies } from "@/lib/retention-window-transcripts"
import { getRetentionWindows } from "@/lib/retention-windows"

// Deep-analysis tables only, in no particular order — none of them cascade
// from or into one another, they just all key off (user_id, analysed_video_id).
const DEEP_ANALYSIS_TABLES = [
  "video_scene_cues",
  "retention_window_snapshots",
  "retention_window_audio",
  "retention_window_scene_cue_scans",
  "retention_window_event_synthesis",
  "retention_window_events",
  "retention_window_costs",
] as const

export async function resetDeepAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<void> {
  await Promise.all(
    DEEP_ANALYSIS_TABLES.map(async (table) => {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId)

      if (error) {
        throw new Error(`Failed to clear ${table}: ${error.message}`)
      }
    }),
  )

  const windows = await getRetentionWindows(supabase, userId, analysedVideoId)

  await Promise.all([
    createPendingRetentionWindowAudio(supabase, userId, analysedVideoId, windows),
    createPendingRetentionWindowSceneCueScans(
      supabase,
      userId,
      analysedVideoId,
      windows,
    ),
    createPendingRetentionWindowEventSynthesis(
      supabase,
      userId,
      analysedVideoId,
      windows,
    ),
    rependRetentionWindowTranscriptTaxonomies(
      supabase,
      userId,
      analysedVideoId,
      windows,
    ),
  ])
}
