// Clears everything the deep-analysis pipeline (scene-cue scans, harvested
// snapshots/audio and their AI analysis, the video-wide feature baseline, and
// synthesized events) has produced for a video — the rows in the deep-analysis
// tables, the harvested objects those rows point at in the retention-window
// media bucket, and the baseline column on the video — while leaving
// `retention_windows` itself, transcripts, and everything light-analysis owns
// (the rest of analysed_videos, pacing) untouched: those are recomputed by
// /api/analyze, not by this pipeline. The uploaded source file and its
// transcoded proxies live in a different bucket entirely
// (lib/source-files/config.ts vs getRetentionWindowMediaBucket) and are never
// touched here — that is the whole point of the retry, which re-runs deep
// analysis against footage the user has already uploaded and paid to transcode.
// Used by the "retry deep analysis" flow
// (app/api/videos/[videoId]/retry-deep-analysis).
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
import { getRetentionWindowMediaStorageProvider } from "@/lib/retention-window-media-config"
import { getRetentionWindows } from "@/lib/retention-windows"
import { runWithConcurrency } from "@/lib/concurrency"
import type { StorageProvider } from "@/lib/storage"

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

// The two tables whose rows point at a harvested object in the media bucket.
const HARVESTED_MEDIA_TABLES = [
  "retention_window_snapshots",
  "retention_window_audio",
] as const

// How many object deletes to keep in flight. These are small, independent
// storage calls, but a long video can have hundreds of them, which is more than
// we want to open on the provider at once.
const MEDIA_DELETE_CONCURRENCY = 10

// Removes every JPEG/MP3 the last run harvested into the retention-window media
// bucket. Object keys are deterministic (user/video/window/…), so a re-run
// overwrites most of them anyway — but only the ones it happens to produce
// again: a window that yields fewer snapshot chunks this time (its scene-cue
// scan found less to sample), or that drops out of the bounded deep-analysis
// window selection entirely, would otherwise leave last run's frames sitting in
// the bucket with no row referencing them, unreachable and billed forever.
// Deleting by the path recorded on each row is exact — it can only touch bytes
// this pipeline wrote — and each delete is best-effort: orphaned bytes are a
// cleanup problem, not a reason to refuse the user their retry.
async function deleteHarvestedMediaObjects(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  mediaStorage: StorageProvider,
): Promise<void> {
  const paths: string[] = []

  for (const table of HARVESTED_MEDIA_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("storage_path")
      .eq("user_id", userId)
      .eq("analysed_video_id", analysedVideoId)

    if (error) {
      throw new Error(
        `Failed to read ${table} storage paths: ${error.message}`,
      )
    }

    for (const row of (data ?? []) as { storage_path: string | null }[]) {
      if (row.storage_path) paths.push(row.storage_path)
    }
  }

  await runWithConcurrency(paths, MEDIA_DELETE_CONCURRENCY, async (path) => {
    try {
      await mediaStorage.deleteObject(path)
    } catch (error) {
      console.error("Failed to delete harvested retention window media", error)
    }
  })
}

export async function resetDeepAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  mediaStorage: StorageProvider = getRetentionWindowMediaStorageProvider(),
): Promise<void> {
  // Before the rows go: they're the only record of which objects this video's
  // harvest wrote.
  await deleteHarvestedMediaObjects(
    supabase,
    userId,
    analysedVideoId,
    mediaStorage,
  )

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

  // The video-wide feature baseline is deep-analysis output too — sampled from
  // the analysis proxy during the extraction stage — it just lives in a column
  // on analysed_videos rather than a table of its own. It has to be cleared
  // here, not merely recomputed later: generateSparseVideoFeatureBaseline
  // returns the stored baseline whenever one is present, so leaving it would
  // carry a partial baseline (its per-range scans are best-effort and a run
  // that lost several still persists what it got) across every retry, with no
  // way for the user to ever shake it off.
  const { error: baselineError } = await supabase
    .from("analysed_videos")
    .update({ deep_feature_baseline: null })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (baselineError) {
    throw new Error(
      `Failed to clear deep feature baseline: ${baselineError.message}`,
    )
  }

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
