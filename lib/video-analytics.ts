// Read/write helpers for the deterministic analytics_summary column on
// analysed_videos. The summary (headline KPIs, engagement, traffic-source mix)
// is fetched once at analyse time and replayed from the column thereafter, so
// we don't re-spend YouTube Analytics quota on every page view. Rows analysed
// before this column existed are backfilled opportunistically the next time
// their detail page is opened.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import { getVideoThumbnailReach } from "@/lib/youtube/reporting"
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

// Returns the stored summary if present and current, otherwise fetches what's
// missing and persists it. The load-bearing KPI totals are fetched once at
// analyse time; thereafter only thumbnail reach is refetched (and patched onto
// the stored summary) until it lands, so a lagging Reporting API report heals in
// without re-spending Analytics quota on the totals. Entirely best-effort: any
// failure resolves to null so a missing summary never breaks the analysis page.
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

    // A stored summary with only stale/absent reach: refetch reach alone and
    // patch it in, keeping the already-fetched totals and traffic sources.
    if (existing) {
      const reach = await getVideoThumbnailReach(accessToken, video.id)
      const patched: VideoAnalyticsSummary = {
        ...existing,
        impressions: reach?.impressions ?? existing.impressions ?? null,
        impressionClickThroughRate:
          reach?.impressionClickThroughRate ??
          existing.impressionClickThroughRate ??
          null,
        reachAttemptedAt: new Date().toISOString(),
      }
      await saveVideoAnalyticsSummary(supabase, userId, analysedVideoId, patched)
      return patched
    }

    const summary = await getVideoAnalyticsSummary(accessToken, video)
    await saveVideoAnalyticsSummary(supabase, userId, analysedVideoId, summary)
    return summary
  } catch (error) {
    console.error("Failed to backfill analytics summary", error)
    return null
  }
}
