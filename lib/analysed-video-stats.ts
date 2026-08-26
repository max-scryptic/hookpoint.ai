// Keeps the numbers stored on analysed_videos rows current.
//
// Analysing a video freezes a snapshot of it: `video_details` carries the
// public counters videos.list served at the time, and `analytics_summary`
// carries the Analytics KPI totals fetched the first time its detail page was
// opened. Left alone, both keep printing whatever the video had on that day -
// so a week-old video with 186 views on YouTube still showed the couple of
// dozen it had when it was analysed, on the list, on the detail page, and in
// any comparison report generated from the row.
//
// This module refreshes both, for a whole library at a time, in a fixed two
// calls per 50 videos: one videos.list for the public counters, one
// Analytics report dimensioned by video for the KPI totals. Every surface that
// prints a stored number calls it first, throttled by METRICS_REFRESH_INTERVAL_MS
// so ordinary navigation between pages doesn't refetch anything.
//
// The two numbers are NOT the same figure and are not expected to match
// exactly: `video_details.viewCount` is YouTube's near-real-time public count,
// while `analytics_summary.views` comes from the Analytics API, which processes
// data on a delay and so trails it by a day or two even when both are freshly
// fetched. What this module guarantees is that each is a recent reading of its
// own source, rather than a months-old one.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  applyLifetimeMetrics,
  isFresh,
  metricsAreCurrent,
  METRICS_REFRESH_INTERVAL_MS,
} from "@/lib/video-analytics"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  getLifetimeMetricsByVideo,
  getVideoStatisticsByVideo,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

export interface RefreshAnalysedVideoStatsOptions {
  // Restrict the refresh to specific analysed_videos rows, by their own UUIDs.
  analysedVideoIds?: string[]
  // Restrict the refresh to specific YouTube video ids.
  videoIds?: string[]
  // Refresh regardless of how recently the numbers were read. Used where a
  // stale figure would be baked into something durable - a comparison report is
  // written once and read for months, so it is worth a guaranteed fetch.
  force?: boolean
}

interface StatsRow {
  id: string
  video_id: string
  video_details: VideoDetails | null
  analytics_summary: VideoAnalyticsSummary | null
}

// Whether this row's stored numbers are recent enough to print without
// refetching. Both halves must be current: the list prints the public counters
// while the detail page and comparisons print the Analytics totals, so a row
// with one stale half still needs the pass.
function statsAreCurrent(row: StatsRow): boolean {
  const detailsCurrent =
    // A row with no stored details has nothing here to refresh.
    row.video_details == null ||
    isFresh(row.video_details.statisticsFetchedAt, METRICS_REFRESH_INTERVAL_MS)
  const summaryCurrent =
    row.analytics_summary != null && metricsAreCurrent(row.analytics_summary)
  return detailsCurrent && summaryCurrent
}

// A summary with nothing in it yet, used as the base a batched reading is
// written onto for a video that has never had one. `fetchedAt` is always
// replaced by the caller.
function emptySummary(): VideoAnalyticsSummary {
  return {
    views: null,
    estimatedMinutesWatched: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    likes: null,
    comments: null,
    shares: null,
    subscribersGained: null,
    subscribersLost: null,
    impressions: null,
    impressionClickThroughRate: null,
    trafficSources: [],
    fetchedAt: "",
  }
}

// Refreshes the stored public counters and KPI totals for a user's analysed
// videos, skipping rows read recently enough (unless `force`). Entirely
// best-effort: a YouTube failure leaves every row exactly as it was, so callers
// simply go on to render the numbers they already had. Callers await this
// before reading the rows they are about to render, so the refreshed values are
// the ones that get printed.
export async function refreshAnalysedVideoStats(
  supabase: SupabaseClient,
  userId: string,
  options: RefreshAnalysedVideoStatsOptions = {},
): Promise<void> {
  try {
    let query = supabase
      .from("analysed_videos")
      .select("id, video_id, video_details, analytics_summary")
      .eq("user_id", userId)
    if (options.analysedVideoIds) {
      query = query.in("id", options.analysedVideoIds)
    }
    if (options.videoIds) {
      query = query.in("video_id", options.videoIds)
    }

    const { data, error } = await query
    if (error) {
      console.error("Failed to load videos for stats refresh", error)
      return
    }

    const rows = (data ?? []) as StatsRow[]
    const due = options.force
      ? rows
      : rows.filter((row) => !statsAreCurrent(row))
    if (due.length === 0) return

    const accessToken = await getGoogleAccessToken(userId)
    const videoIds = due.map((row) => row.video_id)

    // The two reports are independent: a failure in either must not cost us the
    // other, so each resolves to an empty map and simply leaves its half of the
    // row untouched this pass.
    const [statistics, metrics] = await Promise.all([
      getVideoStatisticsByVideo(accessToken, videoIds).catch((error) => {
        console.error("Failed to refresh video statistics", error)
        return null
      }),
      getLifetimeMetricsByVideo(accessToken, videoIds).catch((error) => {
        console.error("Failed to refresh video lifetime metrics", error)
        return null
      }),
    ])
    if (!statistics && !metrics) return

    const fetchedAt = new Date().toISOString()

    await Promise.all(
      due.map(async (row) => {
        const update: {
          video_details?: VideoDetails
          analytics_summary?: VideoAnalyticsSummary
        } = {}

        const stats = statistics?.get(row.video_id)
        if (stats && row.video_details) {
          update.video_details = {
            ...row.video_details,
            viewCount: stats.viewCount,
            commentCount: stats.commentCount,
            // A video that has gone private stops reporting a privacy status we
            // recognise; keep the last known one rather than guessing.
            privacyStatus:
              stats.privacyStatus ?? row.video_details.privacyStatus,
            statisticsFetchedAt: fetchedAt,
          }
        }

        if (metrics) {
          const fresh = metrics.get(row.video_id)
          const existing = row.analytics_summary
          if (fresh) {
            // Videos analysed before ever having a summary get one here, minus
            // the parts this pass doesn't fetch: the traffic-source breakdown
            // needs a per-video report and reach comes from the Reporting API,
            // so both stay unset and their own backfills fill them in.
            update.analytics_summary = applyLifetimeMetrics(
              existing ?? emptySummary(),
              fresh,
              fetchedAt,
            )
          } else if (existing) {
            // A row missing from a report that otherwise succeeded had no
            // activity in the window. Keep whatever the summary already holds
            // rather than zeroing real numbers on a YouTube quirk, but still
            // stamp the read so it isn't refetched on every page load.
            update.analytics_summary = { ...existing, fetchedAt }
          } else {
            // Nothing stored and nothing reported - record the (empty) reading
            // so this video stops forcing a refetch on every page load.
            update.analytics_summary = { ...emptySummary(), fetchedAt }
          }
        }

        if (Object.keys(update).length === 0) return

        const { error: updateError } = await supabase
          .from("analysed_videos")
          .update(update)
          .eq("id", row.id)
          .eq("user_id", userId)
        if (updateError) {
          console.error(
            `Failed to save refreshed stats for video ${row.video_id}`,
            updateError,
          )
        }
      }),
    )
  } catch (error) {
    // Includes the reconsent case: a user whose YouTube grant has lapsed still
    // gets their pages, showing the last numbers we managed to fetch.
    console.error("Failed to refresh analysed video stats", error)
  }
}
