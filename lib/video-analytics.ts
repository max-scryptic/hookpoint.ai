// Read/write helpers for the deterministic analytics_summary column on
// analysed_videos. The summary (headline KPIs, engagement, traffic-source mix)
// is fetched once at analyse time and replayed from the column thereafter, so
// we don't re-spend YouTube Analytics quota on every page view. Rows analysed
// before this column existed are backfilled opportunistically the next time
// their detail page is opened.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
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

// True once a stored summary carries the thumbnail-reach fields (added January
// 2026). A summary that predates them lacks the `impressions` key entirely and
// is refetched once to heal; a summary that HAS the key but a null value (i.e.
// we fetched and YouTube withheld reach) is already current and must not
// refetch on every page view.
function hasReachFields(summary: VideoAnalyticsSummary): boolean {
  return "impressions" in summary
}

// Returns the stored summary if present and current, otherwise fetches it from
// the YouTube Analytics API (spending a Google access token) and persists it.
// Entirely best-effort: any failure resolves to null so a missing summary never
// breaks the analysis page — the section simply doesn't render.
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
    if (existing && hasReachFields(existing)) return existing

    const accessToken = await getGoogleAccessToken(userId)
    const summary = await getVideoAnalyticsSummary(accessToken, video)
    await saveVideoAnalyticsSummary(supabase, userId, analysedVideoId, summary)
    return summary
  } catch (error) {
    console.error("Failed to backfill analytics summary", error)
    return null
  }
}
