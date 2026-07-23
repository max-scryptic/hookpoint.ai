// Read/write helpers for the deterministic analytics_summary column on
// analysed_videos. The summary (headline KPIs, engagement, traffic-source mix)
// is fetched once at analyse time and replayed from the column thereafter, so
// we don't re-spend YouTube Analytics quota on every page view. Rows analysed
// before this column existed are backfilled opportunistically the next time
// their detail page is opened. Thumbnail reach (impressions + CTR) is handled
// separately: it comes from the channel-granular Reporting API, so one fetch is
// fanned out across every one of the user's videos (see
// backfillChannelThumbnailReach).

import type { SupabaseClient } from "@supabase/supabase-js"

import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  fetchChannelThumbnailReach,
  type ThumbnailReach,
} from "@/lib/youtube/reporting"
import {
  getVideoAnalyticsSummary,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// Persists a freshly fetched analytics summary onto the video row. Best-effort:
// callers treat a write failure as "we'll refetch next time", never as fatal.
export async function saveVideoAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  summary: VideoAnalyticsSummary,
): Promise<void> {
  const { error } = await supabase
    .from("analysed_videos")
    .update({ analytics_summary: summary })
    .eq("id", analysedVideoId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to save analytics summary: ${error.message}`)
  }
}

// Reads the stored analytics summary for a video, or null when none has been
// fetched yet.
export async function getStoredVideoAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<VideoAnalyticsSummary | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("analytics_summary")
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load analytics summary: ${error.message}`)
  }

  return (
    (data as { analytics_summary: VideoAnalyticsSummary | null } | null)
      ?.analytics_summary ?? null
  )
}

// How long a null thumbnail-reach reading stays trusted before we retry it.
// Reach comes from the async Reporting API, which produces its first CSV ~24-48h
// after the job is created, so an early-analysed video legitimately has null
// reach that later fills in. We retry on view, but throttle so an established
// null (a video genuinely outside the report window) isn't refetched on every
// page load.
const REACH_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000

// Whether the stored summary's thumbnail reach is current enough to serve as-is.
// A real (non-null) reading is final. A null reading is only current if we tried
// recently — otherwise it's due for a retry, because a null may just mean the
// reporting job hadn't produced a report covering this video yet. Summaries that
// predate the reach fields entirely ("impressions" absent) are never current.
function reachIsCurrent(summary: VideoAnalyticsSummary): boolean {
  if (!("impressions" in summary)) return false
  if (summary.impressions != null || summary.impressionClickThroughRate != null) {
    return true
  }
  const attemptedAt = summary.reachAttemptedAt ?? summary.fetchedAt
  const attempted = attemptedAt ? new Date(attemptedAt).getTime() : 0
  return Number.isFinite(attempted)
    ? Date.now() - attempted < REACH_RETRY_INTERVAL_MS
    : false
}

// Applies a reach reading onto a summary, preserving any existing values when
// the reading is absent (a video not yet in a report) and always stamping the
// attempt time so a still-null reading is throttled from immediate refetch.
function applyReach(
  summary: VideoAnalyticsSummary,
  reach: ThumbnailReach | undefined,
  attemptedAt: string,
): VideoAnalyticsSummary {
  return {
    ...summary,
    impressions: reach?.impressions ?? summary.impressions ?? null,
    impressionClickThroughRate:
      reach?.impressionClickThroughRate ??
      summary.impressionClickThroughRate ??
      null,
    reachAttemptedAt: attemptedAt,
  }
}

// Fetches thumbnail reach for the whole channel in a single pass and patches it
// onto every one of the user's analysed videos that already has a summary.
// Reach ships from the Reporting API at channel granularity — one download
// covers every video — so we fan it out across the entire library rather than
// paying the download per video: analysing or viewing one video fills in CTR for
// all of them. Rows are stamped with reachAttemptedAt so a still-null reading (a
// reporting job with no report yet) is throttled from refetching on every view.
// Returns the reach map so the caller can read the current video's value.
// Best-effort: a load failure leaves rows untouched.
export async function backfillChannelThumbnailReach(
  supabase: SupabaseClient,
  userId: string,
  accessToken: string,
): Promise<Map<string, ThumbnailReach>> {
  const reachByVideo = await fetchChannelThumbnailReach(accessToken)

  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_id, analytics_summary")
    .eq("user_id", userId)
    .not("analytics_summary", "is", null)

  if (error) {
    console.error("Failed to load videos for reach backfill", error)
    return reachByVideo
  }

  const rows = (data ?? []) as Array<{
    id: string
    video_id: string
    analytics_summary: VideoAnalyticsSummary | null
  }>

  const attemptedAt = new Date().toISOString()
  await Promise.all(
    rows.map(async (row) => {
      const summary = row.analytics_summary
      if (!summary) return
      const reach = reachByVideo.get(row.video_id)
      // Nothing to fill and not due for a retry — leave the row alone so an
      // established library isn't rewritten wholesale on every backfill.
      if (!reach && reachIsCurrent(summary)) return
      const { error: updateError } = await supabase
        .from("analysed_videos")
        .update({ analytics_summary: applyReach(summary, reach, attemptedAt) })
        .eq("id", row.id)
        .eq("user_id", userId)
      if (updateError) {
        console.error(
          `Failed to patch reach for video ${row.video_id}`,
          updateError,
        )
      }
    }),
  )

  return reachByVideo
}

// Returns the stored summary if present and current, otherwise fetches what's
// missing and persists it. KPI totals are fetched once at analyse time; reach is
// then populated channel-wide (backfilling every video at once) and patched onto
// this video's summary, so a lagging Reporting API report heals in without
// re-spending Analytics quota on the totals. Entirely best-effort: any failure
// resolves to null so a missing summary never breaks the analysis page.
export async function getOrBackfillVideoAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  video: VideoDetails,
): Promise<VideoAnalyticsSummary | null> {
  try {
    const existing = await getStoredVideoAnalyticsSummary(
      supabase,
      userId,
      analysedVideoId,
    )
    if (existing && reachIsCurrent(existing)) return existing

    const accessToken = await getGoogleAccessToken(userId)

    // Ensure this video has its base summary (KPI totals + traffic sources),
    // fetched once and cached thereafter.
    let base = existing
    if (!base) {
      base = await getVideoAnalyticsSummary(accessToken, video)
      await saveVideoAnalyticsSummary(supabase, userId, analysedVideoId, base)
    }

    // Populate thumbnail reach for the whole channel in one pass — this patches
    // every analysed video (including this one) in the database.
    const reachByVideo = await backfillChannelThumbnailReach(
      supabase,
      userId,
      accessToken,
    )

    return applyReach(
      base,
      reachByVideo.get(video.id),
      new Date().toISOString(),
    )
  } catch (error) {
    console.error("Failed to backfill analytics summary", error)
    return null
  }
}
