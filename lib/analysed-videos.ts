// Read/write helpers for the `analysed_videos` table. Analysing a video spends
// YouTube API quota, so we persist the full result here and replay it instead
// of re-fetching. All calls go through a user-scoped Supabase client, so Row
// Level Security guarantees a user only ever touches their own rows.

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  DropOff,
  RetentionPoint,
  VideoDetails,
} from "@/lib/youtube/youtube"

// A persisted analysis. The JSONB payloads mirror the YouTube/Analytics shapes
// we fetch; they are typed loosely-but-usefully here and will grow over time.
export interface AnalysedVideo {
  id: string
  userId: string
  videoId: string
  videoTitle: string
  dateAnalysed: string
  videoDetails: VideoDetails | null
  retention: RetentionPoint[] | null
  dropOffs: DropOff[] | null
  rawAnalytics: Record<string, unknown> | null
}

// Raw row shape as returned by Supabase (snake_case columns).
interface AnalysedVideoRow {
  id: string
  user_id: string
  video_id: string
  video_title: string
  date_analysed: string
  video_details: VideoDetails | null
  retention: RetentionPoint[] | null
  drop_offs: DropOff[] | null
  raw_analytics: Record<string, unknown> | null
}

const COLUMNS =
  "id, user_id, video_id, video_title, date_analysed, video_details, retention, drop_offs, raw_analytics"

function mapRow(row: AnalysedVideoRow): AnalysedVideo {
  return {
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    dateAnalysed: row.date_analysed,
    videoDetails: row.video_details,
    retention: row.retention,
    dropOffs: row.drop_offs,
    rawAnalytics: row.raw_analytics,
  }
}

export interface SaveAnalysedVideoInput {
  userId: string
  video: VideoDetails
  retention: RetentionPoint[]
  dropOffs: DropOff[]
  // Anything else we fetched that doesn't yet have a dedicated column.
  rawAnalytics?: Record<string, unknown>
}

// Upserts an analysis, keyed on (user_id, video_id) so re-analysing the same
// video refreshes the stored data and bumps `date_analysed`.
export async function saveAnalysedVideo(
  supabase: SupabaseClient,
  input: SaveAnalysedVideoInput,
): Promise<AnalysedVideo | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .upsert(
      {
        user_id: input.userId,
        video_id: input.video.id,
        video_title: input.video.title,
        date_analysed: new Date().toISOString(),
        video_details: input.video,
        retention: input.retention,
        drop_offs: input.dropOffs,
        raw_analytics: input.rawAnalytics ?? null,
      },
      { onConflict: "user_id,video_id" },
    )
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to save analysed video: ${error.message}`)
  }

  return data ? mapRow(data as AnalysedVideoRow) : null
}

// Lists a user's analysed videos, most recently analysed first.
export async function listAnalysedVideos(
  supabase: SupabaseClient,
  userId: string,
): Promise<AnalysedVideo[]> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("date_analysed", { ascending: false })

  if (error) {
    throw new Error(`Failed to load analysed videos: ${error.message}`)
  }

  return (data as AnalysedVideoRow[] | null)?.map(mapRow) ?? []
}

// Fetches a single previously-analysed video, or null if it hasn't been
// analysed yet. Used to serve cached results without re-spending API quota.
export async function getAnalysedVideo(
  supabase: SupabaseClient,
  userId: string,
  videoId: string,
): Promise<AnalysedVideo | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load analysed video: ${error.message}`)
  }

  return data ? mapRow(data as AnalysedVideoRow) : null
}
