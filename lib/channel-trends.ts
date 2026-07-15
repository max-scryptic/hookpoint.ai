// Data for the Channel Trends page (app/dashboard/channel-trends): the size
// of the user's accumulated cross-video event library plus per-kind trend
// aggregations. Built over the same channel event records the synthesizer's
// channelHistory summary uses (lib/channel-event-history.ts), but richer —
// trends carry contributing video titles and example narratives so the page
// can show its evidence — and the library's size drives the progressive
// unlock stages the page renders.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  loadChannelEventRecords,
  type ChannelEventRecord,
} from "@/lib/channel-event-history"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"
import type { RetentionWindowKind } from "@/lib/retention-windows"

// Trend confidence grows with library size: below EARLY the page only shows
// the library filling up; from EARLY trends appear labelled as early signals;
// from ESTABLISHED they're presented at full strength. EARLY deliberately sits
// just above the synthesizer's own two-video minimum — a pattern needs a few
// videos before a page dedicated to it reads as credible.
export const EARLY_TRENDS_VIDEO_THRESHOLD = 3
export const ESTABLISHED_TRENDS_VIDEO_THRESHOLD = 10

export type ChannelTrendsStage = "empty" | "building" | "early" | "established"

export function channelTrendsStage(
  libraryVideoCount: number,
): ChannelTrendsStage {
  if (libraryVideoCount <= 0) return "empty"
  if (libraryVideoCount < EARLY_TRENDS_VIDEO_THRESHOLD) return "building"
  if (libraryVideoCount < ESTABLISHED_TRENDS_VIDEO_THRESHOLD) return "early"
  return "established"
}

// Enough individual occurrences to fill an expanded drill-down without
// unbounded rows for a prolific channel's most common event type.
const MAX_TREND_EVENTS = 25
// Deeper than the synthesizer's prompt-summary cap: the page reports
// library-wide counts, so it reads further back before aggregating.
const MAX_EVENT_ROWS = 2000

// One occurrence of an event type, surfaced when a trend row is expanded so
// the page can show the events behind the count, ranked by confidence.
export interface ChannelTrendEvent {
  narrative: string
  videoTitle: string | null
  confidence: number | null
}

export interface ChannelTrend {
  eventType: RetentionWindowEventType
  eventCount: number
  // Distinct videos this event type appeared in for this window kind —
  // recurrence across videos, not raw volume, is what makes a channel trend.
  videoCount: number
  // The individual occurrences behind eventCount, highest-confidence first,
  // each attributed to its source video — the drill-down under the row. Capped
  // at MAX_TREND_EVENTS, so eventCount can exceed events.length.
  events: ChannelTrendEvent[]
}

export interface ChannelKindTrends {
  eventCount: number
  // Ordered by videoCount desc, then eventCount desc — most channel-wide first.
  trends: ChannelTrend[]
}

export interface ChannelTrendsData {
  stage: ChannelTrendsStage
  // Distinct videos with a completed event synthesis — the library the
  // progressive unlock is measured against.
  libraryVideoCount: number
  // Retention windows whose events have been synthesized, across all videos.
  windowCount: number
  eventCount: number
  hooks: ChannelKindTrends | null
  dropOffs: ChannelKindTrends | null
  gains: ChannelKindTrends | null
}

function kindTrends(
  records: ChannelEventRecord[],
  kind: RetentionWindowKind,
  videoTitleById: Map<string, string>,
): ChannelKindTrends | null {
  const kindRecords = records.filter((record) => record.windowKind === kind)
  if (kindRecords.length === 0) return null

  const byType = new Map<RetentionWindowEventType, ChannelEventRecord[]>()
  for (const record of kindRecords) {
    const group = byType.get(record.eventType)
    if (group) group.push(record)
    else byType.set(record.eventType, [record])
  }

  const trends: ChannelTrend[] = [...byType.entries()]
    .map(([eventType, group]) => {
      const videoIds = [...new Set(group.map((r) => r.analysedVideoId))]
      return {
        eventType,
        eventCount: group.length,
        videoCount: videoIds.length,
        events: [...group]
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
          .slice(0, MAX_TREND_EVENTS)
          .map((record) => ({
            narrative: record.narrative,
            videoTitle: videoTitleById.get(record.analysedVideoId) ?? null,
            confidence: record.confidence ?? null,
          })),
      }
    })
    .sort(
      (a, b) => b.videoCount - a.videoCount || b.eventCount - a.eventCount,
    )

  return { eventCount: kindRecords.length, trends }
}

// Pure aggregation over already-loaded inputs, split from the loader so tests
// don't need a database.
export function buildChannelTrends(params: {
  records: ChannelEventRecord[]
  videoTitleById: Map<string, string>
  libraryVideoCount: number
  windowCount: number
}): ChannelTrendsData {
  const { records, videoTitleById, libraryVideoCount, windowCount } = params
  return {
    stage: channelTrendsStage(libraryVideoCount),
    libraryVideoCount,
    windowCount,
    eventCount: records.length,
    hooks: kindTrends(records, "hook", videoTitleById),
    dropOffs: kindTrends(records, "drop_off", videoTitleById),
    gains: kindTrends(records, "gain", videoTitleById),
  }
}

// The library's size: every window whose event synthesis completed, and the
// distinct videos those windows belong to. Counted from the synthesis jobs
// (not the events) so a deeply-analysed video still grows the library even if
// a window produced no events.
async function loadLibrarySize(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ libraryVideoCount: number; windowCount: number }> {
  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (error) {
    throw new Error(`Failed to load channel library size: ${error.message}`)
  }

  const rows = (data ?? []) as { analysed_video_id: string }[]
  return {
    libraryVideoCount: new Set(rows.map((row) => row.analysed_video_id)).size,
    windowCount: rows.length,
  }
}

async function loadVideoTitles(
  supabase: SupabaseClient,
  userId: string,
  videoIds: string[],
): Promise<Map<string, string>> {
  if (videoIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_title")
    .eq("user_id", userId)
    .in("id", videoIds)

  if (error) {
    throw new Error(`Failed to load video titles: ${error.message}`)
  }

  return new Map(
    ((data ?? []) as { id: string; video_title: string }[]).map((row) => [
      row.id,
      row.video_title,
    ]),
  )
}

export async function getChannelTrends(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChannelTrendsData> {
  const [records, librarySize] = await Promise.all([
    loadChannelEventRecords(supabase, userId, { limit: MAX_EVENT_ROWS }),
    loadLibrarySize(supabase, userId),
  ])
  const videoTitleById = await loadVideoTitles(supabase, userId, [
    ...new Set(records.map((record) => record.analysedVideoId)),
  ])
  return buildChannelTrends({ records, videoTitleById, ...librarySize })
}
